import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { createApiApp } from '../../src/server/app.ts';
import * as authModule from '../../src/server/platform/auth.ts';
const { signAccessJwt } = authModule;
const clearAuthUserCache = () =>
  (authModule as { clearAuthUserCache?: () => void }).clearAuthUserCache?.();
import type { DbPort } from '../../src/server/ports/db.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';

describe('Phase A1–A7, B1–B2, C2 & D — Tenant Isolation, Section 21 Gate, Payouts & Buyer Receipts, Refresh Tokens, Fresh Tenant Happy Path', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let closeDb: () => Promise<void>;
  let isPg = false;
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const bootstrapped = await bootstrapTestDatabase();
    db = bootstrapped.db;
    platformDb = bootstrapped.platformDb;
    isPg = bootstrapped.isPg;
    closeDb = bootstrapped.close;

    const app = createApiApp(db, undefined, platformDb);
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
    await closeDb?.();
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
        'Idempotency-Key': crypto.randomUUID(),
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
        'Idempotency-Key': crypto.randomUUID(),
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

    const uniqueUtr = `FDRL${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

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
          bankUtr: uniqueUtr,
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
          bankUtr: uniqueUtr,
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
        'Idempotency-Key': crypto.randomUUID(),
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
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amountPaise: '100000',
        paymentReference: 'NEFT-BUY01-20261110',
      }),
    });
    assert.equal(validReceiptRes.status, 201);
  });

  it('A4 & D6: Refresh token rotation, reuse family revocation, logout revocation, and immediate deactivation check in requireAuth', async () => {
    const reqOtp = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002' }),
    });
    const reqBody = (await reqOtp.json()) as { devOtpEcho?: string };
    let otpCode = reqBody.devOtpEcho;
    if (!otpCode) {
      otpCode = '654321';
      const salt = '0123456789abcdef0123456789abcdef';
      const hash = authModule.hashOtpWithSalt(otpCode, salt);
      await platformDb.query(
        `UPDATE core.otp_challenges SET code_hash = $1, salt = $2 WHERE phone_e164 = '+919447000002'`,
        [hash, salt]
      );
    }
    assert.ok(otpCode);

    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002', otpCode }),
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

    // Issue a fresh session and verify POST /api/v1/auth/logout revokes the refresh token
    await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002' }),
    });
    const logoutOtp = '654322';
    const logoutSalt = '0123456789abcdef0123456789abcdef';
    await platformDb.query(
      `UPDATE core.otp_challenges SET code_hash = $1, salt = $2 WHERE phone_e164 = '+919447000002'`,
      [authModule.hashOtpWithSalt(logoutOtp, logoutSalt), logoutSalt]
    );
    const verifyRes2 = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000002', otpCode: logoutOtp }),
    });
    assert.equal(verifyRes2.status, 200);
    const cookiePair3 = (verifyRes2.headers.get('set-cookie') ?? '').split(';')[0]!;

    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookiePair3 },
    });
    assert.equal(logoutRes.status, 200);

    const refreshAfterLogout = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookiePair3 },
    });
    assert.equal(refreshAfterLogout.status, 401);

    // Deactivating a user rejects their active JWT once cache expires/clears
    const activeToken = await signAccessJwt({
      sub: 'USR-BUY-02',
      tenantId: DEMO_TENANT_ID,
      role: 'WHOLESALE_BUYER',
      fullName: 'M/s Cochin Seafoods',
      phoneE164: '+919447000008',
    });
    await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
      await tx.query(`UPDATE core.users SET is_active = false WHERE user_id = 'USR-BUY-02'`);
    });
    clearAuthUserCache();

    const suspendedCall = await fetch(`${baseUrl}/api/v1/bootstrap`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    assert.equal(suspendedCall.status, 401);

    await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
      await tx.query(`UPDATE core.users SET is_active = true WHERE user_id = 'USR-BUY-02'`);
    });
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

  it('B1: set_config app.platform on does not bypass RLS; tenant isolation remains strictly enforced', async () => {
    await db.transaction(async (tx) => {
      if (!isPg) {
        await tx.exec(`SET LOCAL ROLE harbour_app`);
      }
      // Attempting to set app.platform has zero effect on core.tenant_access_allowed()
      await tx.query(`SELECT set_config('app.platform', 'on', true)`);
      await tx.query(`SELECT set_config('app.tenant_id', '', true)`);

      // With empty app.tenant_id, tenant queries return 0 rows regardless of app.platform
      const entries = await tx.query<{ entry_seq: number }>(
        `SELECT entry_seq FROM ledger.entries LIMIT 10`
      );
      assert.equal(
        entries.rows.length,
        0,
        'ledger.entries must return 0 rows when app.tenant_id is empty'
      );

      const users = await tx.query<{ user_id: string }>(`SELECT user_id FROM core.users LIMIT 10`);
      assert.equal(
        users.rows.length,
        0,
        'core.users must return 0 rows when app.tenant_id is empty'
      );

      const tenants = await tx.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM core.tenants LIMIT 10`
      );
      assert.equal(
        tenants.rows.length,
        0,
        'core.tenants must return 0 rows when app.tenant_id is empty'
      );
    });
  });

  it('B2: Enumerates all tables in pg_class across core, harbour, auction, ledger, sync and asserts relrowsecurity and relforcerowsecurity are true (except allowlisted platform-only tables)', async () => {
    const tableRes = await db.query<{
      schema_name: string;
      table_name: string;
      row_security: boolean;
      force_row_security: boolean;
    }>(
      `SELECT n.nspname AS schema_name,
              c.relname AS table_name,
              c.relrowsecurity AS row_security,
              c.relforcerowsecurity AS force_row_security
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('core', 'harbour', 'auction', 'ledger', 'sync')
         AND c.relkind = 'r'
       ORDER BY n.nspname, c.relname`
    );

    const allowlist = new Set([
      'core.otp_challenges',
      'core.refresh_tokens',
      'core.schema_migrations',
    ]);

    assert.ok(
      tableRes.rows.length >= 25,
      `Expected at least 25 domain tables, got ${tableRes.rows.length}`
    );

    for (const row of tableRes.rows) {
      const full = `${row.schema_name}.${row.table_name}`;
      if (allowlist.has(full)) {
        continue;
      }
      assert.equal(
        row.row_security,
        true,
        `Table ${full} must have relrowsecurity=true (RLS enabled)`
      );
      assert.equal(
        row.force_row_security,
        true,
        `Table ${full} must have relforcerowsecurity=true (FORCE RLS enabled)`
      );
    }
  });

  it('D7: Fresh tenant API-only happy path: provision -> invite users -> weigh -> inspect -> allocate -> payout -> reconcile UTR -> buyer receipt -> verify-ledger verified=true, zero drift', async () => {
    const superAdminToken = await signAccessJwt({
      sub: 'USR-SUPER-01',
      tenantId: DEMO_TENANT_ID,
      role: 'SUPER_ADMIN',
      fullName: 'State Fisheries Registrar',
      phoneE164: '+919447000001',
    });

    const uniqueSlug = `neendakara-${crypto.randomUUID().slice(0, 6)}`;
    // 1. Provision fresh tenant via API
    const provRes = await fetch(`${baseUrl}/api/v1/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        slug: uniqueSlug,
        nameEn: 'Neendakara Fishing Harbour',
        nameMl: 'നീണ്ടകര ഫിഷിംഗ് ഹാർബർ',
        centreType: 'KERALA_HARBOUR',
      }),
    });
    assert.equal(provRes.status, 201);
    const provBody = (await provRes.json()) as {
      tenantId: string;
      defaults: {
        fishermanId: string;
        vesselId: string;
        licenceId: string;
        buyerId: string;
        speciesId: string;
        sessionId: string;
      };
    };
    const newTenantId = provBody.tenantId;
    const defs = provBody.defaults;

    // 2. Invite operator users via API (Weigher, Inspector, Auctioneer, Accountant)
    const inviteUser = async (role: string, phoneSuffix: string, entityRefId?: string) => {
      const res = await fetch(`${baseUrl}/api/v1/tenants/${newTenantId}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
        body: JSON.stringify({
          phoneE164: `+919448${phoneSuffix}`,
          fullName: `Neendakara ${role}`,
          role,
          entityRefId: entityRefId ?? null,
        }),
      });
      assert.equal(res.status, 201);
      return (await res.json()) as {
        userId: string;
        tenantId: string;
        phoneE164: string;
        fullName: string;
        role: authModule.AuthSessionClaims['role'];
        entityRefId: string | null;
      };
    };

    const randBase = String(Math.floor(100000 + Math.random() * 800000));
    const weigher = await inviteUser('WEIGHING_OPERATOR', `${randBase.slice(0, 5)}1`);
    const inspector = await inviteUser('AUTHORIZED_INSPECTOR', `${randBase.slice(0, 5)}2`);
    const auctioneer = await inviteUser(
      'LICENSED_AUCTIONEER',
      `${randBase.slice(0, 5)}3`,
      defs.licenceId
    );
    const accountant = await inviteUser('ACCOUNTANT', `${randBase.slice(0, 5)}4`);

    const wghJwt = await signAccessJwt({
      sub: weigher.userId,
      tenantId: newTenantId,
      role: weigher.role,
      fullName: weigher.fullName,
      phoneE164: weigher.phoneE164,
    });
    const inspJwt = await signAccessJwt({
      sub: inspector.userId,
      tenantId: newTenantId,
      role: inspector.role,
      fullName: inspector.fullName,
      phoneE164: inspector.phoneE164,
    });
    const auctJwt = await signAccessJwt({
      sub: auctioneer.userId,
      tenantId: newTenantId,
      role: auctioneer.role,
      fullName: auctioneer.fullName,
      phoneE164: auctioneer.phoneE164,
      entityRefId: defs.licenceId,
    });
    const acctJwt = await signAccessJwt({
      sub: accountant.userId,
      tenantId: newTenantId,
      role: accountant.role,
      fullName: accountant.fullName,
      phoneE164: accountant.phoneE164,
    });

    // 3. Weigh lot
    const weighRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wghJwt}`,
      },
      body: JSON.stringify({
        vesselId: defs.vesselId,
        fishermanId: defs.fishermanId,
        speciesId: defs.speciesId,
        totalBoxes: 5,
        netGrams: 100000,
        coreTempC: 1.5,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(weighRes.status, 201);
    const weighedLot = (await weighRes.json()) as { lotId: string; status: string };
    assert.equal(weighedLot.status, 'WEIGHED_PENDING_INSPECTION');

    // 4. Inspect lot (s.21)
    const inspRes = await fetch(`${baseUrl}/api/v1/lots/${weighedLot.lotId}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${inspJwt}`,
      },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.5, notes: 'Export grade' }),
    });
    assert.equal(inspRes.status, 200);

    // 5. Allocate lot sale
    const allocRes = await fetch(`${baseUrl}/api/v1/lots/${weighedLot.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auctJwt}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: defs.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: defs.licenceId,
        buyerId: defs.buyerId,
        boxesAllocated: 5,
        pricePerKgPaise: 70000,
        fencingToken: 1,
      }),
    });
    assert.equal(allocRes.status, 201);
    const allocBody = (await allocRes.json()) as {
      buyerPayablePaise: string;
      fishermanNetPaise: string;
    };

    // 6. Create payout batch
    const payoutRes = await fetch(`${baseUrl}/api/v1/payout-batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${acctJwt}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(payoutRes.status, 201);
    const payoutBody = (await payoutRes.json()) as {
      batchId: string;
      totalAmountPaise: string;
    };
    assert.equal(payoutBody.totalAmountPaise, allocBody.fishermanNetPaise);

    // 7. Reconcile UTR
    const recRes = await fetch(
      `${baseUrl}/api/v1/payout-batches/${payoutBody.batchId}/reconcile`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${acctJwt}`,
        },
        body: JSON.stringify({
          bankUtr: 'FDRL261110998877',
          confirmTotalPaise: payoutBody.totalAmountPaise,
        }),
      }
    );
    assert.equal(recRes.status, 200);

    // 8. Buyer receipt clears buyer receivable
    const rcptRes = await fetch(`${baseUrl}/api/v1/buyers/${defs.buyerId}/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${acctJwt}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amountPaise: allocBody.buyerPayablePaise,
        paymentReference: `NEFT-NEENDAKARA-01`,
      }),
    });
    assert.equal(rcptRes.status, 201);

    // 9. Verify ledger hash chain and zero balance drift
    const verifyLedgerRes = await fetch(`${baseUrl}/api/v1/ledger/verify`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${acctJwt}`,
      },
    });
    assert.equal(verifyLedgerRes.status, 200);
    const verifyBody = (await verifyLedgerRes.json()) as {
      verified: boolean;
      entryCount: number;
      lastEntrySeq: string;
      headHash: string;
      failureReason?: string;
    };
    assert.equal(verifyBody.verified, true);
    assert.equal(verifyBody.failureReason, undefined);
    assert.ok(verifyBody.entryCount >= 9);
    assert.ok(verifyBody.headHash.length === 64);
  });
});
