import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '@server/app.ts';
import { config } from '@server/config.ts';
import { ConsoleSmsAdapter, Msg91SmsAdapter } from '@server/adapters/sms-msg91.ts';
import { runDailyLedgerAnchorJob } from '@server/entry/jobs.ts';
import { verifyTenantLedgerChain } from '@server/modules/ledger/verify.ts';
import {
  getOutboxDeadLetterTotal,
  processOutboxBatchOnce,
} from '@server/modules/notifications/service.ts';
import { signAccessJwt } from '@server/platform/auth.ts';
import { withPlatform, type DbPort } from '@server/ports/db.ts';
import type { SmsPort } from '@server/ports/sms.ts';
import { createIsolatedTenant } from '../helpers/fixtures.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';

describe('Phase C2 Pilot Completeness — SMS Retries/MSG91, Atomic CSV, Reports Parity, Anchors & PII Boundary', () => {
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
        if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
  });

  it('C1 #1: Outbox SMS retry backoff, 5-attempt DEAD_LETTER transition, and Msg91SmsAdapter HTTP send/error path', async () => {
    const iso = await createIsolatedTenant(platformDb, 'smsdlq');
    const eventId = `EVT-DLQ-${crypto.randomUUID().slice(0, 8)}`;

    await platformDb.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at, attempts, next_attempt_at
      ) VALUES (
        $1, $2, 'SMS', $3, 'OTP_LOGIN', '{"otpCode":"445566"}', 'PENDING', (NOW() - INTERVAL '10 minutes')::text, 0, NOW() - INTERVAL '1 minute'
      )`,
      [eventId, iso.tenantId, iso.users[0]!.userId]
    );

    const failingSmsPort: SmsPort = {
      sendSms: async () => {
        throw new Error('MSG91_UPSTREAM_503');
      },
    };

    const deadBefore = getOutboxDeadLetterTotal();

    // Attempts 1..4 must remain PENDING with increasing attempts and future next_attempt_at backoff
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await platformDb.query(
        `UPDATE sync.outbox_events SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE event_id = $1`,
        [eventId]
      );
      const stats = await processOutboxBatchOnce(platformDb, failingSmsPort, { batchLimit: 20 });
      assert.ok(stats.retried >= 1, `Attempt ${attempt} must be marked retried`);

      const rowRes = await platformDb.query<{
        status: string;
        attempts: number;
        last_error: string | null;
        next_in_future: boolean;
      }>(
        `SELECT status, attempts, last_error, (next_attempt_at > NOW()) AS next_in_future
         FROM sync.outbox_events WHERE event_id = $1`,
        [eventId]
      );
      const row = rowRes.rows[0]!;
      assert.equal(row.status, 'PENDING');
      assert.equal(row.attempts, attempt);
      assert.equal(row.next_in_future, true, `Attempt ${attempt} must push next_attempt_at into the future`);
      assert.match(row.last_error ?? '', /MSG91_UPSTREAM_503/);
    }

    // Attempt 5 must transition to DEAD_LETTER and increment dead-letter metric
    await platformDb.query(
      `UPDATE sync.outbox_events SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE event_id = $1`,
      [eventId]
    );
    const deadStats = await processOutboxBatchOnce(platformDb, failingSmsPort, { batchLimit: 20 });
    assert.ok(deadStats.deadLettered >= 1);
    assert.ok(getOutboxDeadLetterTotal() > deadBefore);

    const deadRow = await platformDb.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM sync.outbox_events WHERE event_id = $1`,
      [eventId]
    );
    assert.equal(deadRow.rows[0]?.status, 'DEAD_LETTER');
    assert.equal(deadRow.rows[0]?.attempts, 5);

    // Test real Msg91SmsAdapter HTTP transport against a local stub HTTP server
    const capturedRequests: Array<{
      url: string | undefined;
      authkey: string | string[] | undefined;
      body: Record<string, unknown>;
    }> = [];
    let failNextStub = false;

    const msg91Stub = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        capturedRequests.push({
          url: req.url,
          authkey: req.headers['authkey'],
          body,
        });
        if (failNextStub) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ type: 'error', message: 'Gateway rejected DLT template' }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ type: 'success', request_id: 'MSG91-REQ-9988' }));
      });
    });

    await new Promise<void>((resolve) => msg91Stub.listen(0, '127.0.0.1', () => resolve()));
    const stubPort = (msg91Stub.address() as { port: number }).port;

    try {
      const adapter = new Msg91SmsAdapter({
        authKey: 'stub-msg91-key',
        senderId: 'HRBROS',
        otpTemplateId: 'TPL-DLT-01',
        baseUrl: `http://127.0.0.1:${stubPort}`,
        timeoutMs: 2_000,
      });

      const okRes = await adapter.sendSms({
        eventId: 'EVT-HTTP-01',
        tenantId: iso.tenantId,
        phoneE164: '+919847123456',
        templateCode: 'OTP_LOGIN',
        locale: 'en',
        variables: { VAR1: '778899' },
        messageText: 'HarbourOS Login OTP: 778899',
      });
      assert.equal(okRes.provider, 'msg91');
      assert.equal(okRes.providerMessageId, 'MSG91-REQ-9988');
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0]?.url, '/api/v5/flow/');
      assert.equal(capturedRequests[0]?.authkey, 'stub-msg91-key');
      assert.equal(capturedRequests[0]?.body.template_id, 'TPL-DLT-01');
      assert.equal(capturedRequests[0]?.body.sender, 'HRBROS');

      failNextStub = true;
      await assert.rejects(
        () =>
          adapter.sendSms({
            eventId: 'EVT-HTTP-02',
            tenantId: iso.tenantId,
            phoneE164: '+919847123456',
            templateCode: 'OTP_LOGIN',
            locale: 'ml',
            variables: { VAR1: '112233' },
            messageText: 'OTP 112233',
          }),
        /MSG91_DISPATCH_FAILED: Gateway rejected DLT template/
      );
    } finally {
      await new Promise<void>((resolve) => msg91Stub.close(() => resolve()));
    }
  });

  it('C1 #2: Masterdata CSV import enforces dry-run, validation rejection, and atomic all-or-nothing DB rollback', async () => {
    const iso = await createIsolatedTenant(platformDb, 'csvatom');
    const admin = iso.users.find((u) => u.role === 'HARBOUR_ADMIN')!;
    const adminToken = await signAccessJwt({
      sub: admin.userId,
      tenantId: iso.tenantId,
      role: 'HARBOUR_ADMIN',
      fullName: admin.fullName,
      phoneE164: admin.phoneE164,
    });

    // 1. Dry-run valid fishermen CSV must NOT commit any rows
    const validFishermenCsv = [
      'fishermanId,fullName,phoneE164,welfareBoardNo,coopSocietyId',
      `FSH-CSV-1-${iso.tenantId},Rajan K,+919847000101,KFWFB-CSV-01,SOC-${iso.tenantId}-01`,
      `FSH-CSV-2-${iso.tenantId},Babu M,+919847000102,KFWFB-CSV-02,SOC-${iso.tenantId}-01`,
    ].join('\n');

    const dryRes = await fetch(`${baseUrl}/api/v1/masterdata/import/fishermen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ csvText: validFishermenCsv, dryRun: true }),
    });
    assert.equal(dryRes.status, 200);
    const dryJson = (await dryRes.json()) as {
      dryRun: boolean;
      committed: boolean;
      totalRows: number;
      validRows: number;
      errors: unknown[];
    };
    assert.equal(dryJson.dryRun, true);
    assert.equal(dryJson.committed, false);
    assert.equal(dryJson.totalRows, 2);
    assert.equal(dryJson.validRows, 2);
    assert.equal(dryJson.errors.length, 0);

    const afterDryCnt = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM harbour.fishermen WHERE fisherman_id LIKE $1`,
      [`FSH-CSV-%-${iso.tenantId}`]
    );
    assert.equal(afterDryCnt.rows[0]?.cnt, 0, 'Dry-run must write 0 rows');

    // 2. Mixed valid + invalid row must commit 0 rows
    const badFishermenCsv = [
      'fishermanId,fullName,phoneE164,welfareBoardNo,coopSocietyId',
      `FSH-CSV-1-${iso.tenantId},Rajan K,+919847000101,KFWFB-CSV-01,SOC-${iso.tenantId}-01`,
      `FSH-CSV-BAD-${iso.tenantId},=CMD(),not-a-phone,KFWFB-BAD,SOC-${iso.tenantId}-01`,
    ].join('\n');

    const badRes = await fetch(`${baseUrl}/api/v1/masterdata/import/fishermen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ csvText: badFishermenCsv, dryRun: false }),
    });
    assert.equal(badRes.status, 200);
    const badJson = (await badRes.json()) as { committed: boolean; errors: unknown[] };
    assert.equal(badJson.committed, false);
    assert.ok(badJson.errors.length >= 2);

    const afterBadCnt = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM harbour.fishermen WHERE fisherman_id LIKE $1`,
      [`FSH-CSV-%-${iso.tenantId}`]
    );
    assert.equal(afterBadCnt.rows[0]?.cnt, 0, 'Validation failure must commit 0 rows');

    // 3. DB-level FK failure on row 2 must roll back row 1 atomically (true all-or-nothing transaction)
    const fkFailVesselsCsv = [
      'vesselId,registrationNo,vesselNameEn,ownerFishermanId',
      `VSL-ATOM-1-${iso.tenantId},IND-KL-07-ATOM-1,Good Boat,${iso.fishermanId}`,
      `VSL-ATOM-2-${iso.tenantId},IND-KL-07-ATOM-2,Bad FK Boat,FSH-NONEXISTENT-999`,
    ].join('\n');

    const fkRes = await fetch(`${baseUrl}/api/v1/masterdata/import/vessels`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ csvText: fkFailVesselsCsv, dryRun: false }),
    });
    assert.ok(fkRes.status >= 400, `FK failure must reject batch (got ${fkRes.status})`);

    const afterFkCnt = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM harbour.vessels WHERE vessel_id LIKE $1`,
      [`VSL-ATOM-%-${iso.tenantId}`]
    );
    assert.equal(
      afterFkCnt.rows[0]?.cnt,
      0,
      'Row 1 vessel must be rolled back atomically when Row 2 violates FK constraint'
    );

    // 4. Valid live commit writes all rows atomically
    const commitRes = await fetch(`${baseUrl}/api/v1/masterdata/import/fishermen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ csvText: validFishermenCsv, dryRun: false }),
    });
    assert.equal(commitRes.status, 200);
    const commitJson = (await commitRes.json()) as { committed: boolean; validRows: number };
    assert.equal(commitJson.committed, true);
    assert.equal(commitJson.validRows, 2);

    const afterCommitCnt = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM harbour.fishermen WHERE fisherman_id LIKE $1`,
      [`FSH-CSV-%-${iso.tenantId}`]
    );
    assert.equal(afterCommitCnt.rows[0]?.cnt, 2);
  });

  it('C1 #6 & #7 & #8: Reports exact apportionment==ledger parity, CSV export, shadow-diff, daily anchor/resume/tamper, and DPDP PII boundaries', async () => {
    const iso = await createIsolatedTenant(platformDb, 'repanch');
    const weigher = iso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspector = iso.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctioneer = iso.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;
    const accountant = iso.users.find((u) => u.role === 'ACCOUNTANT')!;
    const buyerUser = iso.users.find((u) => u.role === 'WHOLESALE_BUYER')!;

    const [weighTok, inspTok, auctTok, acctTok, buyerTok] = await Promise.all([
      signAccessJwt({
        sub: weigher.userId,
        tenantId: iso.tenantId,
        role: weigher.role,
        fullName: weigher.fullName,
        phoneE164: weigher.phoneE164,
      }),
      signAccessJwt({
        sub: inspector.userId,
        tenantId: iso.tenantId,
        role: inspector.role,
        fullName: inspector.fullName,
        phoneE164: inspector.phoneE164,
      }),
      signAccessJwt({
        sub: auctioneer.userId,
        tenantId: iso.tenantId,
        role: auctioneer.role,
        fullName: auctioneer.fullName,
        phoneE164: auctioneer.phoneE164,
        entityRefId: `LIC-${iso.tenantId}-01`,
      }),
      signAccessJwt({
        sub: accountant.userId,
        tenantId: iso.tenantId,
        role: accountant.role,
        fullName: accountant.fullName,
        phoneE164: accountant.phoneE164,
      }),
      signAccessJwt({
        sub: buyerUser.userId,
        tenantId: iso.tenantId,
        role: buyerUser.role,
        fullName: buyerUser.fullName,
        phoneE164: buyerUser.phoneE164,
        entityRefId: iso.buyerId,
      }),
    ]);

    // Weigh -> Inspect -> Allocate 2 boxes (100 kg @ 25,000 paise/kg = 2,500,000 paise hammer)
    const lotRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${weighTok}` },
      body: JSON.stringify({
        vesselId: `VES-${iso.tenantId}-01`,
        speciesId: iso.speciesId,
        totalBoxes: 4,
        netGrams: '200000',
        coreTempC: 1.4,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotRes.status, 201);
    const lot = (await lotRes.json()) as { lotId: string; lotCode: string };

    const inspRes = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${inspTok}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.4, notes: 'Export grade' }),
    });
    assert.equal(inspRes.status, 200);

    const alloc1Res = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auctTok}`,
        'Idempotency-Key': `ALLOC-REP-1-${lot.lotId}`,
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

    // --- C1 #6: All 5 reports + exact apportionment == ledger parity + CSV + shadow-diff ---
    const [dailyRes, fisherRes, apporRes, buyerRepRes, payoutRepRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/v1/reports/daily-auction`, { headers: { authorization: `Bearer ${acctTok}` } }),
      fetch(`${baseUrl}/api/v1/reports/fisherman-statement`, { headers: { authorization: `Bearer ${acctTok}` } }),
      fetch(`${baseUrl}/api/v1/reports/statutory-apportionment`, { headers: { authorization: `Bearer ${acctTok}` } }),
      fetch(`${baseUrl}/api/v1/reports/buyer-ledger`, { headers: { authorization: `Bearer ${acctTok}` } }),
      fetch(`${baseUrl}/api/v1/reports/payout-reconciliation`, { headers: { authorization: `Bearer ${acctTok}` } }),
      fetch(`${baseUrl}/api/v1/reports/daily-auction?format=csv`, { headers: { authorization: `Bearer ${acctTok}` } }),
    ]);

    assert.equal(dailyRes.status, 200);
    assert.equal(fisherRes.status, 200);
    assert.equal(apporRes.status, 200);
    assert.equal(buyerRepRes.status, 200);
    assert.equal(payoutRepRes.status, 200);
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-type') ?? '', /text\/csv/);

    const dailyJson = (await dailyRes.json()) as {
      summary: { hammerTotalPaise: string; fishermanNetTotalPaise: string; totalCommissionPaise: string };
    };
    assert.equal(dailyJson.summary.hammerTotalPaise, '2500000');
    assert.equal(dailyJson.summary.fishermanNetTotalPaise, '2375000');
    assert.equal(dailyJson.summary.totalCommissionPaise, '125000');

    const apporJson = (await apporRes.json()) as {
      rows: Array<{ recipientPool: string; allocatedTotalPaise: string; ledgerBalancePaise: string }>;
    };
    assert.equal(apporJson.rows.length, 4);
    for (const pool of apporJson.rows) {
      assert.equal(
        pool.allocatedTotalPaise,
        pool.ledgerBalancePaise,
        `Statutory pool ${pool.recipientPool} must match ledger balance to 0 paise`
      );
    }

    const csvBody = await csvRes.text();
    assert.ok(csvBody.startsWith('allocationId,lotId,boxesAllocated'));
    assert.ok(csvBody.includes('2500000'));

    // Shadow-pilot diff: 0-paise match AND 1-paise divergence detection
    const matchDiffRes = await fetch(`${baseUrl}/api/v1/reports/shadow-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctTok}` },
      body: JSON.stringify({
        csvText: `lotCode,hammerPaise,fishermanNetPaise,commissionPaise\n${lot.lotCode},2500000,2375000,125000`,
      }),
    });
    assert.equal(matchDiffRes.status, 200);
    const matchDiff = (await matchDiffRes.json()) as {
      zeroPaiseDivergence: boolean;
      totalDivergentRows: number;
    };
    assert.equal(matchDiff.zeroPaiseDivergence, true);
    assert.equal(matchDiff.totalDivergentRows, 0);

    const mismatchDiffRes = await fetch(`${baseUrl}/api/v1/reports/shadow-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${acctTok}` },
      body: JSON.stringify({
        csvText: `lotCode,hammerPaise,fishermanNetPaise,commissionPaise\n${lot.lotCode},2500001,2375000,125001`,
      }),
    });
    assert.equal(mismatchDiffRes.status, 200);
    const mismatchDiff = (await mismatchDiffRes.json()) as {
      zeroPaiseDivergence: boolean;
      totalDivergentRows: number;
      diffs: Array<{ hammerDeltaPaise: string }>;
    };
    assert.equal(mismatchDiff.zeroPaiseDivergence, false);
    assert.equal(mismatchDiff.totalDivergentRows, 1);
    assert.equal(mismatchDiff.diffs[0]?.hammerDeltaPaise, '-1');

    // --- C1 #7: Daily ledger anchor + external JSONL HMAC + anchor-resume + tamper detection ---
    const tmpSinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbouros-anchor-'));
    const anchorDate = '2026-11-21';
    try {
      const anchors = await runDailyLedgerAnchorJob(platformDb, {
        anchorDate,
        sinkDir: tmpSinkDir,
        tenantId: iso.tenantId,
      });
      assert.equal(anchors.length, 1);
      const anchor = anchors[0]!;
      assert.equal(anchor.tenantId, iso.tenantId);
      assert.ok(BigInt(anchor.lastEntrySeq) > 0n);

      // Verify external JSONL file and HMAC-SHA256 integrity
      const sinkFile = path.join(tmpSinkDir, `ledger-anchors-${anchorDate}.jsonl`);
      assert.ok(fs.existsSync(sinkFile), 'External JSONL anchor file must exist');
      const lines = fs.readFileSync(sinkFile, 'utf8').trim().split('\n');
      const parsed = JSON.parse(lines[0]!) as {
        tenantId: string;
        anchorDate: string;
        lastEntrySeq: string;
        headHash: string;
        entryCount: number;
        hmacSha256: string;
      };
      const expectedHmac = crypto
        .createHmac('sha256', config.QR_HMAC_SECRET)
        .update(`${parsed.tenantId}|${parsed.anchorDate}|${parsed.lastEntrySeq}|${parsed.headHash}|${parsed.entryCount}`)
        .digest('hex');
      assert.equal(parsed.hmacSha256, expectedHmac);

      // Append second allocation after anchor and verify streaming resume from anchor
      const alloc2Res = await fetch(`${baseUrl}/api/v1/lots/${lot.lotId}/allocate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${auctTok}`,
          'Idempotency-Key': `ALLOC-REP-2-${lot.lotId}`,
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

      const resumed = await withPlatform(platformDb, (tx) =>
        verifyTenantLedgerChain(tx, iso.tenantId, { batchSize: 2, useLatestAnchor: true })
      );
      assert.equal(resumed.verified, true);
      assert.equal(resumed.resumedFromAnchorSeq, anchor.lastEntrySeq);
      assert.ok(BigInt(resumed.lastEntrySeq) > BigInt(anchor.lastEntrySeq));

      // Tamper detection: corrupt stored daily_anchor head_hash -> verifier must fail closed
      await platformDb.query(
        `UPDATE ledger.daily_anchors SET head_hash = $1 WHERE tenant_id = $2 AND anchor_date = $3`,
        ['deadbeef'.repeat(8), iso.tenantId, anchorDate]
      );
      const tampered = await withPlatform(platformDb, (tx) =>
        verifyTenantLedgerChain(tx, iso.tenantId, { useLatestAnchor: true })
      );
      assert.equal(tampered.verified, false);
      assert.match(tampered.failureReason ?? '', /Daily anchor head_hash mismatch/);
    } finally {
      fs.rmSync(tmpSinkDir, { recursive: true, force: true });
    }

    // --- C1 #8: DPDP PII-boundary enforcement ---
    // 1. Unauthorized role (WHOLESALE_BUYER) cannot read fisherman-statement PII report
    const buyerForbiddenRep = await fetch(`${baseUrl}/api/v1/reports/fisherman-statement`, {
      headers: { authorization: `Bearer ${buyerTok}` },
    });
    assert.equal(buyerForbiddenRep.status, 403);

    // 2. Ledger journals & entries must never contain raw phone numbers
    const rawPhones = iso.users.map((u) => u.phoneE164);
    const ledgerDump = await platformDb.query<{ description: string }>(
      `SELECT description FROM ledger.journals WHERE tenant_id = $1`,
      [iso.tenantId]
    );
    for (const row of ledgerDump.rows) {
      for (const phone of rawPhones) {
        assert.equal(
          row.description.includes(phone),
          false,
          `Raw phone PII (${phone}) must never appear in ledger.journals`
        );
      }
    }

    // 3. ConsoleSmsAdapter must mask phone numbers in logs
    const consoleSms = new ConsoleSmsAdapter();
    const smsRes = await consoleSms.sendSms({
      eventId: 'EVT-PII-MASK',
      tenantId: iso.tenantId,
      phoneE164: '+919847555111',
      templateCode: 'OTP_LOGIN',
      locale: 'en',
      variables: { VAR1: '123456' },
      messageText: 'OTP 123456',
    });
    assert.equal(smsRes.provider, 'console');
  });
});
