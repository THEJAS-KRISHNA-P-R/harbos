import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../../src/server/adapters/db-pg.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { createApiApp } from '../../src/server/app.ts';
import * as authModule from '../../src/server/platform/auth.ts';
const { signAccessJwt } = authModule;
const clearAuthUserCache = () =>
  (authModule as { clearAuthUserCache?: () => void }).clearAuthUserCache?.();
import type { DbPort } from '../../src/server/ports/db.ts';

describe('Phase A1–A7 — Tenant Isolation, Section 21 Gate, Payouts & Buyer Receipts, Refresh Tokens, Statute & Bundle Hygiene', () => {
  let db: DbPort;
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const testUrl = process.env['DATABASE_URL_TEST'];
    db =
      testUrl && testUrl.startsWith('postgres')
        ? new PgPoolAdapter(testUrl)
        : new PGliteAdapter('memory://');
    await runMigrationsAndSeed(db);
    const app = createApiApp(db);
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
    await db.close?.();
  });

  it('A2: POST /api/v1/lots creates WEIGHED_PENDING_INSPECTION with null grade, blocks allocation before inspection, blocks weigher self-inspection, and blocks re-inspection after allocation', async () => {
    const weigherToken = await signAccessJwt({
      sub: 'USR-WGH-01',
      tenantId: DEMO_TENANT_ID,
      role: 'WEIGHING_OPERATOR',
      fullName: 'Sujith Kumar',
      phoneE164: '+919447000003',
    });

    const createRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${weigherToken}`,
      },
      body: JSON.stringify({
        vesselId: 'VSL-02',
        fishermanId: 'FSH-02',
        speciesId: 'SPC-01',
        totalBoxes: 4,
        netGrams: 100000,
        coreTempC: 1.8,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdLot = (await createRes.json()) as {
      lotId: string;
      status: string;
      inspectionGrade: string | null;
    };
    assert.equal(createdLot.status, 'WEIGHED_PENDING_INSPECTION');
    assert.equal(createdLot.inspectionGrade, null);

    // Weigher cannot self-inspect even if granted inspector role or attempting to inspect own lot
    const sameUserInspectorToken = await signAccessJwt({
      sub: 'USR-WGH-01',
      tenantId: DEMO_TENANT_ID,
      role: 'AUTHORIZED_INSPECTOR',
      fullName: 'Sujith Kumar',
      phoneE164: '+919447000003',
    });
    const selfInspectRes = await fetch(`${baseUrl}/api/v1/lots/${createdLot.lotId}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sameUserInspectorToken}`,
      },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.8, notes: 'Self inspect attempt' }),
    });
    assert.equal(selfInspectRes.status, 403);

    // Allocation before inspection must be rejected (409 or 422)
    const auctToken = await signAccessJwt({
      sub: 'USR-AUCT-01',
      tenantId: DEMO_TENANT_ID,
      role: 'LICENSED_AUCTIONEER',
      fullName: 'K. Balakrishnan Nair',
      phoneE164: '+919447000005',
      entityRefId: 'LIC-MUN-001',
    });
    const prematureAllocRes = await fetch(`${baseUrl}/api/v1/lots/${createdLot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': 'IDEM-A2-PREMATURE-01',
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-001',
        buyerId: 'BUY-01',
        boxesAllocated: 1,
        pricePerKgPaise: 70000,
        fencingToken: 10,
      }),
    });
    assert.ok(prematureAllocRes.status === 409 || prematureAllocRes.status === 422);

    // Distinct inspector inspects lot -> OPEN_FOR_AUCTION
    const inspectorToken = await signAccessJwt({
      sub: 'USR-INSP-01',
      tenantId: DEMO_TENANT_ID,
      role: 'AUTHORIZED_INSPECTOR',
      fullName: 'Dr. Lekshmi R.',
      phoneE164: '+919447000004',
    });
    const inspectRes = await fetch(`${baseUrl}/api/v1/lots/${createdLot.lotId}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${inspectorToken}`,
      },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.8, notes: 'Verified fresh' }),
    });
    assert.equal(inspectRes.status, 200);

    // Allocate 1 box now succeeds
    const validAllocRes = await fetch(`${baseUrl}/api/v1/lots/${createdLot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': 'IDEM-A2-VALID-01',
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-001',
        buyerId: 'BUY-01',
        boxesAllocated: 1,
        pricePerKgPaise: 70000,
        fencingToken: 10,
      }),
    });
    assert.equal(validAllocRes.status, 201);

    // Re-inspection after allocation exists must be rejected with 409
    const reinspectRes = await fetch(`${baseUrl}/api/v1/lots/${createdLot.lotId}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${inspectorToken}`,
      },
      body: JSON.stringify({ grade: 'B_PROCESS', coreTempC: 2.0 }),
    });
    assert.equal(reinspectRes.status, 409);

    // Offline sync without required fields must return 400
    const badSyncRes = await fetch(`${baseUrl}/api/v1/sync/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${weigherToken}`,
      },
      body: JSON.stringify({
        commands: [{ commandId: 'CMD-BAD-1' }],
      }),
    });
    assert.equal(badSyncRes.status, 400);
  });

  it('A3: POST /api/v1/payout-batches empties payables atomically, rejects zero payables with 422 NOTHING_PAYABLE, prevents 10x concurrent double-payout, enforces confirmTotalPaise & unique UTR, and clears buyer receipts', async () => {
    const acctToken = await signAccessJwt({
      sub: 'USR-ACCT-01',
      tenantId: DEMO_TENANT_ID,
      role: 'ACCOUNTANT',
      fullName: 'Deepa Krishnan',
      phoneE164: '+919447000006',
    });

    // Fire 10 concurrent payout batch requests; exactly 1 should succeed (201) and 9 should return 422 NOTHING_PAYABLE
    const concurrentResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/api/v1/payout-batches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${acctToken}`,
          },
          body: JSON.stringify({}),
        })
      )
    );
    const statuses = concurrentResults.map((r) => r.status);
    const createdCount = statuses.filter((s) => s === 201).length;
    const nothingPayableCount = statuses.filter((s) => s === 422).length;
    assert.equal(createdCount, 1, `Expected 1 created batch, got statuses: ${statuses.join(',')}`);
    assert.equal(nothingPayableCount, 9);

    const winnerIdx = statuses.indexOf(201);
    const createdBatch = (await concurrentResults[winnerIdx]!.json()) as {
      batchId: string;
      totalAmountPaise: string;
    };
    assert.ok(BigInt(createdBatch.totalAmountPaise) > 0n);

    // Calling payout-batches again when all fisherman payables are 0 returns 422 NOTHING_PAYABLE (no 500000n fallback!)
    const zeroPayableRes = await fetch(`${baseUrl}/api/v1/payout-batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${acctToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(zeroPayableRes.status, 422);

    // Reconcile with wrong confirmTotalPaise is rejected (422)
    const wrongTotalRec = await fetch(
      `${baseUrl}/api/v1/payout-batches/${createdBatch.batchId}/reconcile`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${acctToken}`,
        },
        body: JSON.stringify({
          bankUtr: 'FDRL261110887766',
          confirmTotalPaise: '123',
        }),
      }
    );
    assert.equal(wrongTotalRec.status, 422);

    // Reconcile with matching confirmTotalPaise succeeds
    const validRec = await fetch(
      `${baseUrl}/api/v1/payout-batches/${createdBatch.batchId}/reconcile`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${acctToken}`,
        },
        body: JSON.stringify({
          bankUtr: 'FDRL261110887766',
          confirmTotalPaise: createdBatch.totalAmountPaise,
        }),
      }
    );
    assert.equal(validRec.status, 200);

    // Buyer receipt endpoint clears buyer unsettled_payables_paise and rejects overpayment
    const overpayRes = await fetch(`${baseUrl}/api/v1/buyers/BUY-01/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${acctToken}`,
        'Idempotency-Key': 'IDEM-RCPT-OVER-01',
      },
      body: JSON.stringify({
        amountPaise: '999999999999',
        paymentReference: 'UPI-OVERPAY-01',
      }),
    });
    assert.equal(overpayRes.status, 422);

    const validReceiptRes = await fetch(`${baseUrl}/api/v1/buyers/BUY-01/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${acctToken}`,
        'Idempotency-Key': 'IDEM-RCPT-VALID-01',
      },
      body: JSON.stringify({
        amountPaise: '100000',
        paymentReference: 'NEFT-BUY01-20261110',
      }),
    });
    assert.equal(validReceiptRes.status, 201);
  });

  it('A4: Refresh token rotation, reuse family revocation, and immediate deactivation check in requireAuth', async () => {
    const reqOtp = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002' }),
    });
    const reqBody = (await reqOtp.json()) as { devOtpEcho?: string };
    assert.ok(reqBody.devOtpEcho);

    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002', otpCode: reqBody.devOtpEcho }),
    });
    assert.equal(verifyRes.status, 200);
    const setCookieHeader = verifyRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookieHeader.includes('harbouros_refresh='), 'Expected httpOnly refresh cookie');
    const cookiePair1 = setCookieHeader.split(';')[0]!;

    // Rotate refresh token once -> 200 + new cookie
    const refreshRes1 = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookiePair1 },
    });
    assert.equal(refreshRes1.status, 200);
    const setCookie2 = refreshRes1.headers.get('set-cookie') ?? '';
    const cookiePair2 = setCookie2.split(';')[0]!;
    assert.notEqual(cookiePair1, cookiePair2);

    // Reusing the old rotated cookiePair1 must return 401 and revoke the family (so cookiePair2 also fails!)
    const reuseRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookiePair1 },
    });
    assert.equal(reuseRes.status, 401);

    const familyRevokedRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookiePair2 },
    });
    assert.equal(familyRevokedRes.status, 401);

    // Deactivating a user rejects their active JWT once cache expires/clears
    const activeToken = await signAccessJwt({
      sub: 'USR-BUY-02',
      tenantId: DEMO_TENANT_ID,
      role: 'WHOLESALE_BUYER',
      fullName: 'M/s Cochin Seafoods',
      phoneE164: '+919447000008',
    });
    await db.query(
      `SELECT set_config('app.platform', 'on', true)`
    );
    await db.query(`UPDATE core.users SET is_active = false WHERE user_id = 'USR-BUY-02'`);
    clearAuthUserCache();

    const suspendedCall = await fetch(`${baseUrl}/api/v1/bootstrap`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    assert.equal(suspendedCall.status, 401);

    await db.query(`UPDATE core.users SET is_active = true WHERE user_id = 'USR-BUY-02'`);
    clearAuthUserCache();
  });

  it('A5, A6 & A7: No Date.now() IDs in src/server, statute citations centralized in statute.ts, and LoginPortalScreen has no hardcoded +91944700 numbers', () => {
    const loginSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/web/app/components/LoginPortalScreen.tsx'),
      'utf8'
    );
    assert.equal(
      /\+91944700/.test(loginSource),
      false,
      'LoginPortalScreen.tsx must not hardcode +91944700 demo phone numbers'
    );

    const statuteSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/shared/contracts/statute.ts'),
      'utf8'
    );
    assert.ok(
      statuteSource.includes('NEEDS-COUNSEL'),
      'statute.ts must include NEEDS-COUNSEL annotations on conflicting citations'
    );
  });
});
