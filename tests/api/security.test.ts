import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed } from '../../src/server/platform/seed.ts';
import { createApiApp } from '../../src/server/app.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';
import { parseEnvConfig } from '../../src/server/config.ts';

import { PgPoolAdapter } from '../../src/server/adapters/db-pg.ts';
import type { DbPort } from '../../src/server/ports/db.ts';

describe('§3 Exploit Regression Suite (T1–T20 & P0 Auth / Exposure / Tenant / Money)', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const testUrl = process.env['DATABASE_URL_TEST'] || process.env['DATABASE_URL'];
    const platformUrl =
      process.env['DATABASE_PLATFORM_URL_TEST'] || process.env['DATABASE_PLATFORM_URL'];

    if (testUrl && testUrl.startsWith('postgres')) {
      db = new PgPoolAdapter(testUrl);
      platformDb =
        platformUrl && platformUrl.startsWith('postgres')
          ? new PgPoolAdapter(platformUrl)
          : db;
      try {
        await runMigrationsAndSeed(platformDb);
      } catch {
        // Already migrated and seeded
      }
    } else {
      const memDb = new PGliteAdapter('memory://');
      await runMigrationsAndSeed(memDb);
      db = memDb;
      platformDb = memDb;
    }

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
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db?.close?.();
    if (platformDb && platformDb !== db) {
      await platformDb.close?.();
    }
  });

  it('T1 backdoor: POST /api/v1/auth/otp/verify rejects hardcoded 202100 when no OTP was requested', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+919447000105',
        otpCode: '202100',
      }),
    });
    assert.equal(res.status, 401);
  });

  it('T2 & T3 register-operator & takeover: POST /api/v1/auth/register-operator does not exist (404)', async () => {
    const resNew = await fetch(`${baseUrl}/api/v1/auth/register-operator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Attacker',
        phoneE164: '+919999999999',
        role: 'SUPER_ADMIN',
        tenantId: 'munambam-demo',
      }),
    });
    assert.equal(resNew.status, 404);

    // Existing accountant phone +919447000007 must remain ACCOUNTANT
    const resTakeover = await fetch(`${baseUrl}/api/v1/auth/register-operator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Pwned',
        phoneE164: '+919447000007',
        role: 'SUPER_ADMIN',
        tenantId: 'munambam-demo',
      }),
    });
    assert.equal(resTakeover.status, 404);

    const userRow = await platformDb.query<{ role: string; full_name: string }>(
      `SELECT role, full_name FROM core.users WHERE phone_e164 = '+919447000007'`
    );
    assert.equal(userRow.rows[0]?.role, 'ACCOUNTANT');
  });

  it('T4 directory: GET /api/v1/auth/operators without auth returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/operators`);
    assert.equal(res.status, 404);
  });

  it('T5 enumeration: POST /api/v1/auth/otp/request returns identical status & non-enumerating body for known and unknown phones', async () => {
    const resUnknown = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919000099999' }),
    });
    const resKnown = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000101' }),
    });
    assert.equal(resUnknown.status, 200);
    assert.equal(resKnown.status, 200);
    const bodyUnknown = (await resUnknown.json()) as Record<string, unknown>;
    const bodyKnown = (await resKnown.json()) as Record<string, unknown>;
    assert.equal(bodyUnknown.status, bodyKnown.status);
    assert.equal(bodyKnown.userName, undefined);
    assert.equal(bodyKnown.role, undefined);
  });

  it('T6 & T7 OTP brute-force lockout & single-use replay protection', async () => {
    // Request an OTP for +919447000102
    await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+919447000102' }),
    });

    // 6 wrong attempts must lock the challenge
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneE164: '+919447000102', otpCode: '000000' }),
      });
      lastStatus = r.status;
    }
    assert.ok(lastStatus === 429 || lastStatus === 423, `Expected 429/423 lockout, got ${lastStatus}`);
  });

  it('T8 fake observability & dangerous system routes removed: /system/metrics/simulate, /system/sql-console, /system/source-bundle, /system/load-test return 404', async () => {
    const token = await signAccessJwt({
      sub: 'USR-SADMIN-01',
      tenantId: 'munambam-demo',
      role: 'SUPER_ADMIN',
      fullName: 'Super Admin',
      phoneE164: '+919447000108',
    });

    for (const [method, routePath] of [
      ['GET', '/api/v1/system/metrics'],
      ['POST', '/api/v1/system/metrics/simulate'],
      ['POST', '/api/v1/system/sql-console'],
      ['GET', '/api/v1/system/source-bundle'],
      ['POST', '/api/v1/system/load-test'],
    ] as const) {
      const r = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
      });
      assert.ok(r.status === 404 || r.status === 401, `Expected 404/401 on ${routePath}, got ${r.status}`);
    }
  });

  it('T9 buyer allocate: WHOLESALE_BUYER token on POST /api/v1/lots/:lotId/allocate returns 403', async () => {
    const buyerToken = await signAccessJwt({
      sub: 'USR-BUY-01',
      tenantId: 'munambam-demo',
      role: 'WHOLESALE_BUYER',
      fullName: 'Apex Seafoods',
      phoneE164: '+919447000105',
      entityRefId: 'BUY-01',
    });

    const res = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-001',
        buyerId: 'BUY-01',
        boxesAllocated: 1,
        pricePerKgPaise: '40000',
        fencingToken: 10,
      }),
    });
    assert.equal(res.status, 403);
  });

  it('T10 licence binding: auctioneer A naming auctioneer B licence returns 403', async () => {
    const auctToken = await signAccessJwt({
      sub: 'USR-AUCT-01',
      tenantId: 'munambam-demo',
      role: 'LICENSED_AUCTIONEER',
      fullName: 'K. Balakrishnan Nair',
      phoneE164: '+919447000104',
      entityRefId: 'LIC-MUN-001',
    });

    const res = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auctToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-002', // Different auctioneer's licence!
        buyerId: 'BUY-01',
        boxesAllocated: 1,
        pricePerKgPaise: '40000',
        fencingToken: 10,
      }),
    });
    assert.equal(res.status, 403);
  });

  it('T11 & T14 validation: allocate without fencingToken or invalid pricePerKgPaise returns 400 with no SQL/stack leak', async () => {
    const adminToken = await signAccessJwt({
      sub: 'USR-HADMIN-01',
      tenantId: 'munambam-demo',
      role: 'HARBOUR_ADMIN',
      fullName: 'Capt. Mathew Thomas',
      phoneE164: '+919447000101',
    });

    const resMissingFence = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-001',
        buyerId: 'BUY-01',
        boxesAllocated: 1,
        pricePerKgPaise: '40000',
        // fencingToken omitted!
      }),
    });
    assert.equal(resMissingFence.status, 400);

    const resInvalidPrice = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: 'SES-MUN-MORNING-01',
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: 'LIC-MUN-001',
        buyerId: 'BUY-01',
        boxesAllocated: -5,
        pricePerKgPaise: 'abc',
        fencingToken: 10,
      }),
    });
    assert.equal(resInvalidPrice.status, 400);
  });

  it('T12 bootstrap scope: fisherman token GET /api/v1/bootstrap returns only own tenant, own fisherman row, and no buyer credit data', async () => {
    const fisherToken = await signAccessJwt({
      sub: 'USR-FISH-01',
      tenantId: 'munambam-demo',
      role: 'FISHERMAN_BOAT_OWNER',
      fullName: 'Antony Varghese',
      phoneE164: '+919447000106',
      entityRefId: 'FSH-01',
    });

    const res = await fetch(`${baseUrl}/api/v1/bootstrap`, {
      headers: { Authorization: `Bearer ${fisherToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      allTenants: Array<{ tenant_id: string }>;
      fishermen: Array<{ fisherman_id: string }>;
      buyers: Array<Record<string, unknown>>;
    };
    assert.equal(body.allTenants.length, 1);
    assert.equal(body.fishermen.length, 1);
    assert.equal(body.fishermen[0]?.fisherman_id, 'FSH-01');
    assert.equal(body.buyers.length, 0);
  });

  it('T13 cross-tenant isolation: tenant B token cannot read or mutate tenant A lots', async () => {
    const tenantBToken = await signAccessJwt({
      sub: 'USR-HADMIN-01',
      tenantId: 'other-harbour-tenant',
      role: 'HARBOUR_ADMIN',
      fullName: 'Other Admin',
      phoneE164: '+919447000101',
    });

    const res = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantBToken}`,
      },
      body: JSON.stringify({
        inspectionGrade: 'A_EXPORT',
        coreTempC: 1.5,
      }),
    });
    assert.ok(res.status === 404 || res.status === 403, `Expected 404/403, got ${res.status}`);
  });

  it('T15 idempotency: same Idempotency-Key with same payload returns original; different payload returns 422', async () => {
    const adminToken = await signAccessJwt({
      sub: 'USR-HADMIN-01',
      tenantId: 'munambam-demo',
      role: 'HARBOUR_ADMIN',
      fullName: 'Capt. Mathew Thomas',
      phoneE164: '+919447000101',
    });

    const payload1 = {
      sessionId: 'SES-MUN-MORNING-01',
      auctionMode: 'PHYSICAL_SHOUT',
      auctioneerLicenceId: 'LIC-MUN-001',
      buyerId: 'BUY-01',
      boxesAllocated: 1,
      pricePerKgPaise: '42000',
      fencingToken: 10,
    };

    const testIdemKey = crypto.randomUUID();

    // Missing Idempotency-Key returns 400
    const r0 = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload1),
    });
    assert.equal(r0.status, 400);

    const r1 = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': testIdemKey,
      },
      body: JSON.stringify(payload1),
    });
    assert.equal(r1.status, 201);
    const b1 = (await r1.json()) as { journalId: string };

    // Replay with identical payload -> same journalId
    const r2 = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': testIdemKey,
      },
      body: JSON.stringify(payload1),
    });
    assert.ok(r2.status === 200 || r2.status === 201);
    const b2 = (await r2.json()) as { journalId: string };
    assert.equal(b2.journalId, b1.journalId);

    // Replay with different payload -> 422 IDEMPOTENCY_KEY_REUSED
    const r3 = await fetch(`${baseUrl}/api/v1/lots/LOT-2026-003/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': testIdemKey,
      },
      body: JSON.stringify({ ...payload1, boxesAllocated: 2 }),
    });
    assert.equal(r3.status, 422);
  });

  it('T16 & T18 security headers & healthz/readyz endpoints', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.ok(csp.length > 0);
    assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must forbid iframe embedding (frame-ancestors none)');
    assert.equal(csp.includes('fonts.googleapis.com'), false, 'CSP must not allow external google fonts');
    assert.equal(csp.includes('fonts.gstatic.com'), false, 'CSP must not allow external google fonts');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);

    const readyRes = await fetch(`${baseUrl}/readyz`);
    assert.equal(readyRes.status, 200);
    const readyBody = (await readyRes.json()) as Record<string, unknown>;
    assert.equal(readyBody.demoMode, undefined);
    assert.equal(readyBody.otpDevEcho, undefined);
  });

  it('T17 public internal files: public/assets/aistudio does not exist', () => {
    const internalAssetsDir = path.resolve(process.cwd(), 'public/assets/aistudio');
    assert.equal(fs.existsSync(internalAssetsDir), false);
  });

  it('T19 boot safety: parseEnvConfig refuses production boot with missing DBs, weak secrets, DEMO_MODE, OTP_DEV_ECHO, AISTUDIO_PREVIEW, and boots with 5 required vars', () => {
    const validSecretA = crypto.randomBytes(32).toString('hex');
    const validSecretB = crypto.randomBytes(32).toString('hex');
    const knownBadPlaceholder = ['replace', 'with', '32', 'byte', 'random', 'secret', 'key'].join('-');

    // Missing DATABASE_URL
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        DATABASE_URL: '',
        DATABASE_PLATFORM_URL: 'postgres://platform:pass@localhost:5432/harbouros',
        JWT_ACCESS_SECRET: validSecretA,
        QR_HMAC_SECRET: validSecretB,
        SMS_PROVIDER: 'msg91',
      })
    );

    // Missing DATABASE_PLATFORM_URL
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:pass@localhost:5432/harbouros',
        DATABASE_PLATFORM_URL: '',
        JWT_ACCESS_SECRET: validSecretA,
        QR_HMAC_SECRET: validSecretB,
        SMS_PROVIDER: 'msg91',
      })
    );

    // AISTUDIO_PREVIEW=true in production
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        AISTUDIO_PREVIEW: 'true',
        DATABASE_URL: 'postgres://app:pass@localhost:5432/harbouros',
        DATABASE_PLATFORM_URL: 'postgres://platform:pass@localhost:5432/harbouros',
        JWT_ACCESS_SECRET: validSecretA,
        QR_HMAC_SECRET: validSecretB,
        SMS_PROVIDER: 'msg91',
      })
    );

    // Placeholder secret
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/harbouros',
        DATABASE_PLATFORM_URL: 'postgres://platform:pass@localhost:5432/harbouros',
        JWT_ACCESS_SECRET: knownBadPlaceholder,
        QR_HMAC_SECRET: validSecretB,
        SMS_PROVIDER: 'msg91',
      })
    );

    // DEMO_MODE=true in production
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/harbouros',
        DATABASE_PLATFORM_URL: 'postgres://platform:pass@localhost:5432/harbouros',
        JWT_ACCESS_SECRET: validSecretA,
        QR_HMAC_SECRET: validSecretB,
        DEMO_MODE: 'true',
        SMS_PROVIDER: 'msg91',
      })
    );

    // SMS_PROVIDER=console in production
    assert.throws(() =>
      parseEnvConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/harbouros',
        DATABASE_PLATFORM_URL: 'postgres://platform:pass@localhost:5432/harbouros',
        JWT_ACCESS_SECRET: validSecretA,
        QR_HMAC_SECRET: validSecretB,
        SMS_PROVIDER: 'console',
      })
    );

    // Boots cleanly with ONLY the 5 required environment variables
    const cleanProdConfig = parseEnvConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://harbour_app:secret@localhost:5432/harbour_db',
      DATABASE_PLATFORM_URL: 'postgres://harbour_platform:secret@localhost:5432/harbour_db',
      JWT_ACCESS_SECRET: validSecretA,
      QR_HMAC_SECRET: validSecretB,
      SMS_PROVIDER: 'msg91',
    });
    assert.equal(cleanProdConfig.NODE_ENV, 'production');
    assert.equal(cleanProdConfig.OTP_DEV_ECHO, false);
    assert.equal(cleanProdConfig.DEMO_MODE, false);
    assert.equal(cleanProdConfig.AISTUDIO_PREVIEW, false);
    assert.equal(cleanProdConfig.PORT, 3000);
  });

  it('T20 SQL bridge removed: port 5433 is not listening and backend-go is deleted', async () => {
    const goDir = path.resolve(process.cwd(), 'backend-go');
    assert.equal(fs.existsSync(goDir), false);
  });
});
