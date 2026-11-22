import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '@server/app.ts';
import { config } from '@server/config.ts';
import { Msg91SmsAdapter } from '@server/adapters/sms-msg91.ts';
import { runDailyLedgerAnchorJob } from '@server/entry/jobs.ts';
import { verifyTenantLedgerChain } from '@server/modules/ledger/verify.ts';
import { computeValidGstinCheckChar } from '@server/modules/masterdata/service.ts';
import {
  getOutboxDeadLetterTotal,
  processOutboxBatchOnce,
} from '@server/modules/notifications/service.ts';
import { escapeRfc4180CsvCell } from '@server/modules/reports/service.ts';
import { signAccessJwt } from '@server/platform/auth.ts';
import type { DbPort } from '@server/ports/db.ts';
import type { SmsPort } from '@server/ports/sms.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { createIsolatedTenant } from '../helpers/fixtures.ts';

describe('C1 Backend Compliance: MSG91/Outbox, Atomic CSV Import, Reports Parity, Daily Anchors & DPDP PII Boundary', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let closeDb: () => Promise<void>;
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const bootstrapped = await bootstrapTestDatabase();
    db = bootstrapped.db;
    platformDb = bootstrapped.platformDb;
    closeDb = bootstrapped.close;

    const app = createApiApp(db, undefined, platformDb, db);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
  });

  it('C1 #1a: Msg91SmsAdapter sends real HTTP POST to /api/v5/flow/ and surfaces HTTP/API errors', async () => {
    const receivedRequests: Array<{
      url: string;
      authkey: string;
      body: Record<string, unknown>;
    }> = [];
    let nextMode: 'ok' | 'api_error' | 'http_502' = 'ok';

    const msg91Stub = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        receivedRequests.push({
          url: req.url ?? '',
          authkey: String(req.headers['authkey'] ?? ''),
          body: JSON.parse(bodyText) as Record<string, unknown>,
        });
        if (nextMode === 'http_502') {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'Upstream gateway timeout' }));
          return;
        }
        if (nextMode === 'api_error') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', message: 'Invalid DLT template_id' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'success', request_id: 'MSG91-REQ-998877' }));
      });
    });

    await new Promise<void>((resolve) => msg91Stub.listen(0, '127.0.0.1', () => resolve()));
    const stubAddr = msg91Stub.address() as { port: number };

    try {
      const adapter = new Msg91SmsAdapter({
        authKey: 'test-msg91-auth-key-2026',
        senderId: 'HRBROS',
        otpTemplateId: 'DLT-TPL-TEST-01',
        baseUrl: `http://127.0.0.1:${stubAddr.port}`,
        timeoutMs: 3_000,
      });

      const okRes = await adapter.sendSms({
        eventId: 'EVT-MSG91-OK',
        tenantId: 'ten-msg91',
        phoneE164: '+919847123456',
        templateCode: 'OTP_LOGIN',
        locale: 'ml',
        variables: { VAR1: '445566' },
        messageText: 'HarbourOS OTP: 445566',
      });

      assert.equal(okRes.provider, 'msg91');
      assert.equal(okRes.providerMessageId, 'MSG91-REQ-998877');
      assert.equal(receivedRequests.length, 1);
      assert.equal(receivedRequests[0]!.url, '/api/v5/flow/');
      assert.equal(receivedRequests[0]!.authkey, 'test-msg91-auth-key-2026');
      assert.equal(receivedRequests[0]!.body.template_id, 'DLT-TPL-TEST-01');
      assert.equal(receivedRequests[0]!.body.sender, 'HRBROS');
      const recipients = receivedRequests[0]!.body.recipients as Array<Record<string, unknown>>;
      assert.equal(recipients[0]!.mobiles, '919847123456');

      nextMode = 'api_error';
      await assert.rejects(
        () =>
          adapter.sendSms({
            eventId: 'EVT-MSG91-ERR',
            tenantId: 'ten-msg91',
            phoneE164: '+919847123456',
            templateCode: 'OTP_LOGIN',
            locale: 'en',
            variables: { VAR1: '112233' },
            messageText: 'HarbourOS OTP: 112233',
          }),
        /MSG91_DISPATCH_FAILED: Invalid DLT template_id/
      );

      nextMode = 'http_502';
      await assert.rejects(
        () =>
          adapter.sendSms({
            eventId: 'EVT-MSG91-502',
            tenantId: 'ten-msg91',
            phoneE164: '+919847123456',
            templateCode: 'OTP_LOGIN',
            locale: 'en',
            variables: { VAR1: '112233' },
            messageText: 'HarbourOS OTP: 112233',
          }),
        /MSG91_DISPATCH_FAILED: Upstream gateway timeout/
      );
    } finally {
      await new Promise<void>((resolve) => msg91Stub.close(() => resolve()));
    }
  });

  it('C1 #1b: Outbox worker enforces exponential backoff retries, per-phone hourly cap, and DEAD_LETTER after 5 failures', async () => {
    const iso = await createIsolatedTenant(platformDb, 'dlq');
    const eventId = `EVT-DLQ-${crypto.randomUUID().slice(0, 8)}`;
    const recipientPhone = `+9197${crypto.randomInt(10000000, 99999999)}`;

    await platformDb.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at, attempts, next_attempt_at
      ) VALUES (
        $1, $2, 'SMS', $3, 'OTP_LOGIN', '{"otpCode":"991122"}', 'PENDING', (NOW() - INTERVAL '5 minutes')::text, 0, NOW() - INTERVAL '1 minute'
      )`,
      [eventId, iso.tenantId, recipientPhone]
    );

    const alwaysFailPort: SmsPort = {
      sendSms: async () => {
        throw new Error('SIMULATED_PROVIDER_503');
      },
    };

    const deadLetterBefore = getOutboxDeadLetterTotal();

    // Attempts 1..4 should remain PENDING with incremented attempts and future next_attempt_at
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await platformDb.query(
        `UPDATE sync.outbox_events SET next_attempt_at = NOW() - INTERVAL '5 seconds' WHERE event_id = $1`,
        [eventId]
      );
      const res = await processOutboxBatchOnce(platformDb, alwaysFailPort, { batchLimit: 50 });
      assert.ok(res.retried >= 1, `Attempt ${attempt} must record retry`);

      const rowRes = await platformDb.query<{
        status: string;
        attempts: number;
        last_error: string;
        next_attempt_at: string;
      }>(
        `SELECT status, attempts, last_error, next_attempt_at::text AS next_attempt_at
         FROM sync.outbox_events WHERE event_id = $1`,
        [eventId]
      );
      const row = rowRes.rows[0]!;
      assert.equal(row.status, 'PENDING');
      assert.equal(row.attempts, attempt);
      assert.match(row.last_error, /SIMULATED_PROVIDER_503/);
      assert.ok(
        new Date(row.next_attempt_at).getTime() > Date.now(),
        `Attempt ${attempt} must push next_attempt_at into the future`
      );
    }

    // Attempt 5 must transition to DEAD_LETTER and increment Prometheus dead-letter counter
    await platformDb.query(
      `UPDATE sync.outbox_events SET next_attempt_at = NOW() - INTERVAL '5 seconds' WHERE event_id = $1`,
      [eventId]
    );
    const finalRes = await processOutboxBatchOnce(platformDb, alwaysFailPort, { batchLimit: 50 });
    assert.ok(finalRes.deadLettered >= 1);
    assert.ok(getOutboxDeadLetterTotal() >= deadLetterBefore + 1);

    const dlRow = (
      await platformDb.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM sync.outbox_events WHERE event_id = $1`,
        [eventId]
      )
    ).rows[0]!;
    assert.equal(dlRow.status, 'DEAD_LETTER');
    assert.equal(dlRow.attempts, 5);

    // Per-phone hourly cap check: allow 1 SMS/hour, verify 2nd SMS to same phone is deferred
    const capPhone = `+9196${crypto.randomInt(10000000, 99999999)}`;
    const evCap1 = `EVT-CAP1-${crypto.randomUUID().slice(0, 8)}`;
    const evCap2 = `EVT-CAP2-${crypto.randomUUID().slice(0, 8)}`;
    await platformDb.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at, attempts, next_attempt_at
      ) VALUES
        ($1, $3, 'SMS', $4, 'LOT_SOLD', '{"lotCode":"LOT-1","boxes":1,"fishermanNetPaise":"10000"}', 'PENDING', (NOW() - INTERVAL '2 minutes')::text, 0, NOW() - INTERVAL '1 minute'),
        ($2, $3, 'SMS', $4, 'LOT_SOLD', '{"lotCode":"LOT-2","boxes":1,"fishermanNetPaise":"10000"}', 'PENDING', (NOW() - INTERVAL '1 minute')::text, 0, NOW() - INTERVAL '30 seconds')`,
      [evCap1, evCap2, iso.tenantId, capPhone]
    );

    const okPort: SmsPort = {
      sendSms: async (req) => ({ provider: 'msg91', providerMessageId: `OK-${req.eventId}` }),
    };

    await processOutboxBatchOnce(platformDb, okPort, {
      batchLimit: 50,
      maxPhonePerHour: 1,
      maxPhonePerDay: 10,
    });

    const capRows = (
      await platformDb.query<{ event_id: string; status: string; last_error: string | null }>(
        `SELECT event_id, status, last_error FROM sync.outbox_events WHERE event_id IN ($1, $2) ORDER BY event_id`,
        [evCap1, evCap2]
      )
    ).rows;
    const row1 = capRows.find((r) => r.event_id === evCap1)!;
    const row2 = capRows.find((r) => r.event_id === evCap2)!;
    assert.equal(row1.status, 'DISPATCHED');
    assert.equal(row2.status, 'PENDING');
    assert.match(row2.last_error ?? '', /Per-phone hourly cap exceeded/);
  });

  it('C1 #2: Masterdata CSV import enforces dryRun, formula-injection guard, GSTIN checksum, and atomic all-or-nothing rollback', async () => {
    const iso = await createIsolatedTenant(platformDb, 'csvimp');
    const admin = iso.users.find((u) => u.role === 'HARBOUR_ADMIN')!;
    const adminToken = await signAccessJwt({
      sub: admin.userId,
      tenantId: iso.tenantId,
      role: 'HARBOUR_ADMIN',
      fullName: admin.fullName,
      phoneE164: admin.phoneE164,
    });

    // 1. dryRun rejects formula injection and invalid GSTIN checksum without writing any rows
    const badBuyerCsv = [
      'buyerName,paddleNo,gstin',
      '=CMD|calc,201,32AAAAA0000A1Z0',
      'Clean Export Buyer,202,32BBBBB1111B1Z0',
    ].join('\n');

    const dryRes = await fetch(`${baseUrl}/api/v1/masterdata/import/buyers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ csvText: badBuyerCsv, dryRun: true }),
    });
    assert.equal(dryRes.status, 200);
    const dryJson = (await dryRes.json()) as {
      dryRun: boolean;
      committed: boolean;
      errors: Array<{ row: number; field: string; message: string }>;
    };
    assert.equal(dryJson.dryRun, true);
    assert.equal(dryJson.committed, false);
    assert.ok(dryJson.errors.some((e) => e.field === 'buyerName' && /formula injection/i.test(e.message)));
    assert.ok(dryJson.errors.some((e) => e.field === 'gstin' && /checksum/i.test(e.message)));

    // 2. Valid buyers CSV commits atomically with valid mod-36 GSTIN
    const validPrefix14 = '32AABCU9603R1Z';
    const validGstin = `${validPrefix14}${computeValidGstinCheckChar(validPrefix14)}`;
    const goodBuyerCsv = [
      'buyerName,paddleNo,gstin,escrowBalancePaise,approvedCreditPaise',
      `Malabar Cold Chain,301,${validGstin},1000000,5000000`,
      `Kochi Marine Exports,302,,2000000,4000000`,
    ].join('\n');

    const commitRes = await fetch(`${baseUrl}/api/v1/masterdata/import/buyers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ csvText: goodBuyerCsv, dryRun: false }),
    });
    assert.equal(commitRes.status, 200);
    const commitJson = (await commitRes.json()) as { committed: boolean; validRows: number };
    assert.equal(commitJson.committed, true);
    assert.equal(commitJson.validRows, 2);

    // 3. Atomic all-or-nothing rollback: row 1 valid vessel + row 2 nonexistent ownerFishermanId (FK violation)
    const atomicFailCsv = [
      'vesselId,registrationNo,vesselNameEn,ownerFishermanId',
      `VSL-ROLLBACK-1-${iso.tenantId},IND-KL-07-MM-7701,Should Roll Back,${iso.fishermanId}`,
      `VSL-ROLLBACK-2-${iso.tenantId},IND-KL-07-MM-7702,Bad FK Vessel,FSH-NONEXISTENT-999`,
    ].join('\n');

    const atomicRes = await fetch(`${baseUrl}/api/v1/masterdata/import/vessels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ csvText: atomicFailCsv, dryRun: false }),
    });
    assert.ok(atomicRes.status >= 400, `Expected FK failure status >= 400, got ${atomicRes.status}`);

    // Verify row 1 was rolled back (0 rows from this batch persisted)
    const checkRollback = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM harbour.vessels WHERE vessel_id = $1`,
      [`VSL-ROLLBACK-1-${iso.tenantId}`]
    );
    assert.equal(
      checkRollback.rows[0]!.cnt,
      0,
      'Row 1 of failed CSV import must be rolled back atomically when row 2 fails DB constraint'
    );
  });

  it('C1 #6: All 5 statutory reports maintain exact apportionment==ledger parity, formula-safe CSV export, and 0-paise shadow-diff', async () => {
    const iso = await createIsolatedTenant(platformDb, 'rep');
    const weighUser = iso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspUser = iso.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctUser = iso.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;
    const acctUser = iso.users.find((u) => u.role === 'ACCOUNTANT')!;

    const [weighToken, inspToken, auctToken, acctToken] = await Promise.all([
      signAccessJwt({ sub: weighUser.userId, tenantId: iso.tenantId, role: weighUser.role, fullName: weighUser.fullName, phoneE164: weighUser.phoneE164 }),
      signAccessJwt({ sub: inspUser.userId, tenantId: iso.tenantId, role: inspUser.role, fullName: inspUser.fullName, phoneE164: inspUser.phoneE164 }),
      signAccessJwt({ sub: auctUser.userId, tenantId: iso.tenantId, role: auctUser.role, fullName: auctUser.fullName, phoneE164: auctUser.phoneE164, entityRefId: `LIC-${iso.tenantId}-01` }),
      signAccessJwt({ sub: acctUser.userId, tenantId: iso.tenantId, role: acctUser.role, fullName: acctUser.fullName, phoneE164: acctUser.phoneE164 }),
    ]);

    // Weigh -> Inspect -> Allocate
    const lotRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${weighToken}` },
      body: JSON.stringify({
        vesselId: `VES-${iso.tenantId}-01`,
        speciesId: iso.speciesId,
        totalBoxes: 5,
        netGrams: '200000',
        coreTempC: 1.4,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotRes.status, 201);
    const lot = (await lotRes.json()) as { lotId: string; lotCode: string };

    const inspectRes = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${inspToken}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.4, notes: 'Report parity check' }),
    });
    assert.equal(inspectRes.status, 200);

    const allocRes = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': `REP-ALLOC-${lot.lotId}`,
      },
      body: JSON.stringify({
        sessionId: iso.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: `LIC-${iso.tenantId}-01`,
        buyerId: iso.buyerId,
        boxesAllocated: 5,
        pricePerKgPaise: '40000',
        fencingToken: 1,
      }),
    });
    assert.equal(allocRes.status, 201);
    const alloc = (await allocRes.json()) as {
      hammerPaise: string;
      fishermanNetPaise: string;
      buyerPayablePaise: string;
    };
    const commissionPaise = (
      BigInt(alloc.hammerPaise) - BigInt(alloc.fishermanNetPaise)
    ).toString();

    // Record buyer receipt & generate + reconcile payout batch
    const receiptRes = await fetch(`${baseUrl}/api/v1/buyers/${iso.buyerId}/receipts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${acctToken}`,
        'Idempotency-Key': `REP-RCPT-${lot.lotId}`,
      },
      body: JSON.stringify({
        amountPaise: alloc.buyerPayablePaise,
        paymentChannel: 'NEFT',
        referenceNo: 'NEFT2026REP001',
      }),
    });
    assert.equal(receiptRes.status, 201);

    const batchRes = await fetch(`${baseUrl}/api/v1/payout-batches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(batchRes.status, 201);
    const batch = (await batchRes.json()) as { batchId: string; totalAmountPaise: string };

    const recRes = await fetch(`${baseUrl}/api/v1/payout-batches/${batch.batchId}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctToken}` },
      body: JSON.stringify({
        bankUtr: 'SBIN261121009988',
        confirmTotalPaise: batch.totalAmountPaise,
      }),
    });
    assert.equal(recRes.status, 200);

    // 1. Statutory apportionment report: EXACT 0-paise parity between allocated sums and ledger account balances
    const appRes = await fetch(`${baseUrl}/api/v1/reports/statutory-apportionment`, {
      headers: { authorization: `Bearer ${acctToken}` },
    });
    assert.equal(appRes.status, 200);
    const appJson = (await appRes.json()) as {
      rows: Array<{ recipientPool: string; allocatedTotalPaise: string; ledgerBalancePaise: string }>;
    };
    assert.equal(appJson.rows.length, 4);
    for (const pool of appJson.rows) {
      assert.equal(
        pool.allocatedTotalPaise,
        pool.ledgerBalancePaise,
        `Statutory apportionment pool ${pool.recipientPool} must match ledger balance to the exact paisa`
      );
      assert.ok(BigInt(pool.allocatedTotalPaise) > 0n, `Pool ${pool.recipientPool} must be non-zero`);
    }

    // 2. Daily auction JSON + RFC 4180 CSV export
    const dailyJsonRes = await fetch(`${baseUrl}/api/v1/reports/daily-auction`, {
      headers: { authorization: `Bearer ${acctToken}` },
    });
    assert.equal(dailyJsonRes.status, 200);
    const dailyJson = (await dailyJsonRes.json()) as {
      summary: { hammerTotalPaise: string; fishermanNetTotalPaise: string; allocationCount: number };
    };
    assert.equal(dailyJson.summary.allocationCount, 1);
    assert.equal(dailyJson.summary.hammerTotalPaise, alloc.hammerPaise);

    const dailyCsvRes = await fetch(`${baseUrl}/api/v1/reports/daily-auction?format=csv`, {
      headers: { authorization: `Bearer ${acctToken}` },
    });
    assert.equal(dailyCsvRes.status, 200);
    assert.match(dailyCsvRes.headers.get('content-type') ?? '', /text\/csv/i);
    const dailyCsvText = await dailyCsvRes.text();
    assert.match(dailyCsvText, /^allocationId,lotId,boxesAllocated/m);
    assert.match(dailyCsvText, new RegExp(lot.lotId));
    assert.equal(escapeRfc4180CsvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);

    // 3. Fisherman statement, buyer ledger, and payout reconciliation reports
    const [fshRepRes, buyRepRes, payRepRes] = await Promise.all([
      fetch(`${baseUrl}/api/v1/reports/fisherman-statement`, { headers: { authorization: `Bearer ${acctToken}` } }),
      fetch(`${baseUrl}/api/v1/reports/buyer-ledger`, { headers: { authorization: `Bearer ${acctToken}` } }),
      fetch(`${baseUrl}/api/v1/reports/payout-reconciliation`, { headers: { authorization: `Bearer ${acctToken}` } }),
    ]);
    assert.equal(fshRepRes.status, 200);
    assert.equal(buyRepRes.status, 200);
    assert.equal(payRepRes.status, 200);

    const fshRep = (await fshRepRes.json()) as {
      rows: Array<{ grossHammerPaise: string; fishermanNet95PctPaise: string; payoutsSettledPaise: string; closingPayableBalancePaise: string }>;
    };
    assert.equal(fshRep.rows[0]!.grossHammerPaise, alloc.hammerPaise);
    assert.equal(fshRep.rows[0]!.payoutsSettledPaise, alloc.fishermanNetPaise);
    assert.equal(fshRep.rows[0]!.closingPayableBalancePaise, '0');

    const buyRep = (await buyRepRes.json()) as {
      rows: Array<{ purchasesPaise: string; receiptsPaise: string; closingUnsettledPaise: string }>;
    };
    assert.equal(buyRep.rows[0]!.purchasesPaise, alloc.buyerPayablePaise);
    assert.equal(buyRep.rows[0]!.receiptsPaise, alloc.buyerPayablePaise);
    assert.equal(buyRep.rows[0]!.closingUnsettledPaise, '0');

    const payRep = (await payRepRes.json()) as {
      summary: { totalBatches: number; reconciledBatches: number; unreconciledBatches: number };
    };
    assert.equal(payRep.summary.totalBatches, 1);
    assert.equal(payRep.summary.reconciledBatches, 1);
    assert.equal(payRep.summary.unreconciledBatches, 0);

    // 4. Shadow-pilot diff: 0-paise exact match & 1-paise divergence detection
    const exactPaperCsv = [
      'lotCode,hammerPaise,fishermanNetPaise,commissionPaise',
      `${lot.lotCode},${alloc.hammerPaise},${alloc.fishermanNetPaise},${commissionPaise}`,
    ].join('\n');

    const matchRes = await fetch(`${baseUrl}/api/v1/reports/shadow-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctToken}` },
      body: JSON.stringify({ csvText: exactPaperCsv }),
    });
    assert.equal(matchRes.status, 200);
    const matchJson = (await matchRes.json()) as {
      zeroPaiseDivergence: boolean;
      totalCompared: number;
      totalDivergentRows: number;
    };
    assert.equal(matchJson.zeroPaiseDivergence, true);
    assert.equal(matchJson.totalCompared, 1);
    assert.equal(matchJson.totalDivergentRows, 0);

    const offByOneHammer = (BigInt(alloc.hammerPaise) - 1n).toString();
    const divergentPaperCsv = [
      'lotCode,hammerPaise,fishermanNetPaise,commissionPaise',
      `${lot.lotCode},${offByOneHammer},${alloc.fishermanNetPaise},${commissionPaise}`,
    ].join('\n');

    const divRes = await fetch(`${baseUrl}/api/v1/reports/shadow-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctToken}` },
      body: JSON.stringify({ csvText: divergentPaperCsv }),
    });
    assert.equal(divRes.status, 200);
    const divJson = (await divRes.json()) as {
      zeroPaiseDivergence: boolean;
      totalDivergentRows: number;
      diffs: Array<{ hammerDeltaPaise: string; matched: boolean }>;
    };
    assert.equal(divJson.zeroPaiseDivergence, false);
    assert.equal(divJson.totalDivergentRows, 1);
    assert.equal(divJson.diffs[0]!.matched, false);
    assert.equal(divJson.diffs[0]!.hammerDeltaPaise, '1');
  });

  it('C1 #7: Daily ledger anchor job writes verified JSONL+HMAC, supports anchor-resume streaming, and catches tampering', async () => {
    const iso = await createIsolatedTenant(platformDb, 'anch');
    const weighUser = iso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspUser = iso.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctUser = iso.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;

    const [weighToken, inspToken, auctToken] = await Promise.all([
      signAccessJwt({ sub: weighUser.userId, tenantId: iso.tenantId, role: weighUser.role, fullName: weighUser.fullName, phoneE164: weighUser.phoneE164 }),
      signAccessJwt({ sub: inspUser.userId, tenantId: iso.tenantId, role: inspUser.role, fullName: inspUser.fullName, phoneE164: inspUser.phoneE164 }),
      signAccessJwt({ sub: auctUser.userId, tenantId: iso.tenantId, role: auctUser.role, fullName: auctUser.fullName, phoneE164: auctUser.phoneE164, entityRefId: `LIC-${iso.tenantId}-01` }),
    ]);

    const lotRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${weighToken}` },
      body: JSON.stringify({
        vesselId: `VES-${iso.tenantId}-01`,
        speciesId: iso.speciesId,
        totalBoxes: 4,
        netGrams: '160000',
        coreTempC: 1.5,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotRes.status, 201);
    const lot = (await lotRes.json()) as { lotId: string };

    await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${inspToken}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.5, notes: 'Anchor check' }),
    });

    // Allocation 1 -> produces first batch of ledger entries
    const alloc1Res = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': `ANCH-A1-${lot.lotId}`,
      },
      body: JSON.stringify({
        sessionId: iso.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: `LIC-${iso.tenantId}-01`,
        buyerId: iso.buyerId,
        boxesAllocated: 2,
        pricePerKgPaise: '25000',
        fencingToken: 1,
      }),
    });
    assert.equal(alloc1Res.status, 201);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbouros-anchor-test-'));
    const anchorDate = '2026-11-21';

    try {
      // 1. Run daily anchor job and verify external JSONL + HMAC-SHA256
      const anchors = await runDailyLedgerAnchorJob(platformDb, { anchorDate, sinkDir: tmpDir });
      const tenantAnchor = anchors.find((a) => a.tenantId === iso.tenantId);
      assert.ok(tenantAnchor, 'Daily anchor job must anchor the isolated tenant');
      assert.ok(Number(tenantAnchor.lastEntrySeq) >= 6);

      const expectedCanonical = `${tenantAnchor.tenantId}|${anchorDate}|${tenantAnchor.lastEntrySeq}|${tenantAnchor.headHash}|${tenantAnchor.entryCount}`;
      const expectedHmac = crypto
        .createHmac('sha256', config.QR_HMAC_SECRET)
        .update(expectedCanonical)
        .digest('hex');
      assert.equal(tenantAnchor.hmacSha256, expectedHmac);

      const jsonlPath = path.join(tmpDir, `ledger-anchors-${anchorDate}.jsonl`);
      assert.ok(fs.existsSync(jsonlPath), 'External JSONL anchor sink file must be written');
      const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
      const parsedRecord = lines
        .map((l) => JSON.parse(l) as { tenantId: string; hmacSha256: string; headHash: string })
        .find((r) => r.tenantId === iso.tenantId);
      assert.ok(parsedRecord);
      assert.equal(parsedRecord.hmacSha256, expectedHmac);
      assert.equal(parsedRecord.headHash, tenantAnchor.headHash);

      // 2. Allocation 2 -> verify streaming resume from anchor with small batchSize=2
      const alloc2Res = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${auctToken}`,
          'Idempotency-Key': `ANCH-A2-${lot.lotId}`,
        },
        body: JSON.stringify({
          sessionId: iso.sessionId,
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: `LIC-${iso.tenantId}-01`,
          buyerId: iso.buyerId,
          boxesAllocated: 2,
          pricePerKgPaise: '25000',
          fencingToken: 1,
        }),
      });
      assert.equal(alloc2Res.status, 201);

      const resumed = await verifyTenantLedgerChain(platformDb, iso.tenantId, {
        batchSize: 2,
        useLatestAnchor: true,
      });
      assert.equal(resumed.verified, true);
      assert.equal(resumed.resumedFromAnchorSeq, tenantAnchor.lastEntrySeq);
      assert.ok(Number(resumed.lastEntrySeq) > Number(tenantAnchor.lastEntrySeq));
      assert.equal(resumed.entryCount, Number(resumed.lastEntrySeq));

      // 3. Tamper detection A: forged anchor head_hash must fail verification immediately
      await platformDb.query(
        `UPDATE ledger.daily_anchors SET head_hash = $1 WHERE tenant_id = $2 AND anchor_date = $3`,
        ['0'.repeat(64), iso.tenantId, anchorDate]
      );
      const anchorTamper = await verifyTenantLedgerChain(platformDb, iso.tenantId, {
        useLatestAnchor: true,
      });
      assert.equal(anchorTamper.verified, false);
      assert.equal(anchorTamper.failedAtSeq, tenantAnchor.lastEntrySeq);
      assert.match(anchorTamper.failureReason ?? '', /Daily anchor head_hash mismatch/);

      // 4. Tamper detection B: mutated ledger entry digest in stream must fail at exact seq
      const tamperingProxyDb: DbPort = {
        dialect: platformDb.dialect,
        query: async <T = Record<string, unknown>>(sql: string, params?: ReadonlyArray<unknown>) => {
          const r = await platformDb.query<T>(sql, params);
          if (sql.includes('FROM ledger.entries') && sql.includes('ORDER BY entry_seq ASC')) {
            return {
              ...r,
              rows: r.rows.map((row) => {
                const rec = row as Record<string, unknown>;
                if (String(rec.entry_seq) === '2') {
                  return { ...rec, row_hash: 'f'.repeat(64) } as T;
                }
                return row;
              }),
            };
          }
          return r;
        },
        transaction: (fn) => platformDb.transaction(fn),
      };

      const digestTamper = await verifyTenantLedgerChain(tamperingProxyDb, iso.tenantId, {
        batchSize: 2,
        useLatestAnchor: false,
      });
      assert.equal(digestTamper.verified, false);
      assert.equal(digestTamper.failedAtSeq, '2');
      assert.match(digestTamper.failureReason ?? '', /SHA-256 digest mismatch at seq 2/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('C1 #8: DPDP PII-boundary test guarantees zero fisherman PII leaks in ledger tables and cross-role buyer responses', async () => {
    const iso = await createIsolatedTenant(platformDb, 'piibnd');
    const admin = iso.users.find((u) => u.role === 'HARBOUR_ADMIN')!;
    const buyer = iso.users.find((u) => u.role === 'WHOLESALE_BUYER')!;
    const weighUser = iso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspUser = iso.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctUser = iso.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;

    const [adminToken, buyerToken, weighToken, inspToken, auctToken] = await Promise.all([
      signAccessJwt({ sub: admin.userId, tenantId: iso.tenantId, role: admin.role, fullName: admin.fullName, phoneE164: admin.phoneE164 }),
      signAccessJwt({ sub: buyer.userId, tenantId: iso.tenantId, role: buyer.role, fullName: buyer.fullName, phoneE164: buyer.phoneE164, entityRefId: iso.buyerId }),
      signAccessJwt({ sub: weighUser.userId, tenantId: iso.tenantId, role: weighUser.role, fullName: weighUser.fullName, phoneE164: weighUser.phoneE164 }),
      signAccessJwt({ sub: inspUser.userId, tenantId: iso.tenantId, role: inspUser.role, fullName: inspUser.fullName, phoneE164: inspUser.phoneE164 }),
      signAccessJwt({ sub: auctUser.userId, tenantId: iso.tenantId, role: auctUser.role, fullName: auctUser.fullName, phoneE164: auctUser.phoneE164, entityRefId: `LIC-${iso.tenantId}-01` }),
    ]);

    const secretPhone = '+919876543219';
    const secretBankRef = 'SBIN0009876-PRIV-554433';

    // Update isolated fisherman with distinct sensitive PII fields
    const upsertFsh = await fetch(`${baseUrl}/api/v1/masterdata/fishermen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        fishermanId: iso.fishermanId,
        fullName: 'Rajan Sensitive Fisher',
        phoneE164: secretPhone,
        welfareBoardNo: 'KFWFB-PII-99',
        coopSocietyId: `SOC-${iso.tenantId}-01`,
        bankAccountRef: secretBankRef,
      }),
    });
    assert.equal(upsertFsh.status, 201);

    // Queue a sensitive OTP outbox event to verify bootstrap never leaks OTP payloads
    await platformDb.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at, attempts, next_attempt_at
      ) VALUES (
        $1, $2, 'SMS', $3, 'OTP_LOGIN', '{"otpCode":"739104"}', 'PENDING', NOW()::text, 0, NOW() + INTERVAL '1 hour'
      )`,
      [`EVT-PII-${crypto.randomUUID().slice(0, 8)}`, iso.tenantId, secretPhone]
    );

    // Execute weigh -> inspect -> allocate so ledger entries & journals are written
    const lotRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${weighToken}` },
      body: JSON.stringify({
        vesselId: `VES-${iso.tenantId}-01`,
        speciesId: iso.speciesId,
        totalBoxes: 2,
        netGrams: '80000',
        coreTempC: 1.3,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotRes.status, 201);
    const lot = (await lotRes.json()) as { lotId: string };

    await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${inspToken}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.3, notes: 'PII boundary test' }),
    });
    const allocRes = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': `PII-ALLOC-${lot.lotId}`,
      },
      body: JSON.stringify({
        sessionId: iso.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: `LIC-${iso.tenantId}-01`,
        buyerId: iso.buyerId,
        boxesAllocated: 2,
        pricePerKgPaise: '25000',
        fencingToken: 1,
      }),
    });
    assert.equal(allocRes.status, 201);

    // 1. Ledger boundary: zero phone numbers or bank account refs in ledger.journals or ledger.entries
    const [journalsRes, entriesRes] = await Promise.all([
      platformDb.query(`SELECT * FROM ledger.journals WHERE tenant_id = $1`, [iso.tenantId]),
      platformDb.query(`SELECT * FROM ledger.entries WHERE tenant_id = $1`, [iso.tenantId]),
    ]);
    const ledgerDump = JSON.stringify({ journals: journalsRes.rows, entries: entriesRes.rows });
    assert.equal(ledgerDump.includes(secretPhone), false, 'ledger tables must NEVER store raw fisherman phoneE164');
    assert.equal(ledgerDump.includes(secretBankRef), false, 'ledger tables must NEVER store raw bankAccountRef');

    // 2. Cross-role API boundary: WHOLESALE_BUYER calling /bootstrap & /lots sees zero fisherman phone/bank/OTP
    const [buyerBootRes, buyerLotsRes, adminBootRes] = await Promise.all([
      fetch(`${baseUrl}/api/v1/bootstrap`, { headers: { authorization: `Bearer ${buyerToken}` } }),
      fetch(`${baseUrl}/api/v1/lots`, { headers: { authorization: `Bearer ${buyerToken}` } }),
      fetch(`${baseUrl}/api/v1/bootstrap`, { headers: { authorization: `Bearer ${adminToken}` } }),
    ]);
    assert.equal(buyerBootRes.status, 200);
    assert.equal(buyerLotsRes.status, 200);
    assert.equal(adminBootRes.status, 200);

    const buyerBootText = await buyerBootRes.text();
    const buyerLotsText = await buyerLotsRes.text();
    const adminBootText = await adminBootRes.text();

    assert.equal(buyerBootText.includes(secretPhone), false, 'WHOLESALE_BUYER /bootstrap must NOT expose fisherman phone_e164');
    assert.equal(buyerBootText.includes(secretBankRef), false, 'WHOLESALE_BUYER /bootstrap must NOT expose fisherman bank_account_ref');
    assert.equal(buyerBootText.includes('739104'), false, 'WHOLESALE_BUYER /bootstrap must NOT expose OTP codes');
    assert.equal(buyerLotsText.includes(secretPhone), false, 'WHOLESALE_BUYER /lots must NOT expose fisherman phone_e164');
    assert.equal(adminBootText.includes('739104'), false, 'Even HARBOUR_ADMIN /bootstrap must redact OTP_LOGIN payloads');
  });
});
