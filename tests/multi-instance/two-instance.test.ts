import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApiApp } from '../../src/server/app.ts';
import { signAccessJwt, clearAuthUserCache } from '../../src/server/platform/auth.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { createIsolatedTenant } from '../helpers/fixtures.ts';

test('Multi-Instance Concurrency — Shared Database State across Independent Nodes', async (t) => {
  const { db, platformDb, close } = await bootstrapTestDatabase();

  // Spin up two independent Express instances sharing the same DB adapter
  const app1 = createApiApp(db, undefined, platformDb);
  const app2 = createApiApp(db, undefined, platformDb);

  const server1: Server = await new Promise((resolve) => {
    const s = app1.listen(0, '127.0.0.1', () => resolve(s));
  });
  const server2: Server = await new Promise((resolve) => {
    const s = app2.listen(0, '127.0.0.1', () => resolve(s));
  });

  const addr1 = server1.address();
  const addr2 = server2.address();
  const port1 = typeof addr1 === 'object' && addr1 ? addr1.port : 0;
  const port2 = typeof addr2 === 'object' && addr2 ? addr2.port : 0;
  const baseUrl1 = `http://127.0.0.1:${port1}`;
  const baseUrl2 = `http://127.0.0.1:${port2}`;

  // Create isolated tenant for multi-instance tests
  const iso = await createIsolatedTenant(platformDb, 'multi');
  const weighUser = iso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
  const acctUser = iso.users.find((u) => u.role === 'ACCOUNTANT')!;

  const weighToken = await signAccessJwt({
    sub: weighUser.userId,
    tenantId: iso.tenantId,
    role: weighUser.role,
    fullName: weighUser.fullName,
    phoneE164: weighUser.phoneE164,
  });

  const acctToken = await signAccessJwt({
    sub: acctUser.userId,
    tenantId: iso.tenantId,
    role: acctUser.role,
    fullName: acctUser.fullName,
    phoneE164: acctUser.phoneE164,
  });

  await t.test('1. Cross-Instance Idempotency Replay (DB-backed in core.idempotency_keys)', async () => {
    // Provide unsettled payables so receipt settlement succeeds under Act 16 rules
    await platformDb.query(
      `UPDATE harbour.buyers SET unsettled_payables_paise = 1000000 WHERE tenant_id = $1 AND buyer_id = $2`,
      [iso.tenantId, iso.buyerId]
    );

    const idemKey = `IDEM-CROSS-TEST-${Date.now()}`;
    const payload = {
      amountPaise: '500000',
      paymentChannel: 'NEFT',
      referenceNo: `REF-${Date.now()}`,
    };

    // First write on Instance 1
    const res1 = await fetch(`${baseUrl1}/api/v1/buyers/${iso.buyerId}/receipts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${acctToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 201, 'Instance 1 must record the buyer receipt');
    const body1 = (await res1.json()) as { amountPaise: string; unsettledPayablesPaise: string };
    assert.equal(body1.amountPaise, '500000');

    // Replay exact same request with same Idempotency-Key on Instance 2
    const res2 = await fetch(`${baseUrl2}/api/v1/buyers/${iso.buyerId}/receipts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${acctToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify(payload),
    });

    assert.ok(
      res2.status === 200 || res2.status === 201,
      `Instance 2 must return 200 or 201 on idempotent replay (got ${res2.status})`
    );
    const body2 = (await res2.json()) as { amountPaise: string; unsettledPayablesPaise: string };
    assert.equal(
      body2.amountPaise,
      body1.amountPaise,
      'Instance 2 must replay the exact same receipt amount recorded on Instance 1'
    );
    assert.equal(
      body2.unsettledPayablesPaise,
      body1.unsettledPayablesPaise,
      'Instance 2 must replay the exact balance from DB idempotency record'
    );
  });

  await t.test('2. Distributed Auth Rate Limit across instances (backed by core.auth_rate_limits)', async () => {
    const testIp = '198.51.100.99';
    let hitCount = 0;
    let rateLimitedOnInstance2 = false;

    // Send requests alternating between Instance 1 and Instance 2
    for (let i = 0; i < 30; i++) {
      const targetUrl = i % 2 === 0 ? baseUrl1 : baseUrl2;
      const res = await fetch(`${targetUrl}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ phoneE164: '+919447990011' }),
      });

      hitCount++;
      if (res.status === 429) {
        // Must trip rate limit across instances
        rateLimitedOnInstance2 = true;
        break;
      }
    }

    assert.ok(
      rateLimitedOnInstance2,
      `Cross-instance auth rate limiter must trigger 429 within 30 hits (tripped after ${hitCount} requests)`
    );
  });

  await t.test('3. Immediate Cross-Instance Session Suspension on User Deactivation', async () => {
    // Verify user can query on Instance 1
    const initialRes = await fetch(`${baseUrl1}/api/v1/me`, {
      headers: { authorization: `Bearer ${weighToken}` },
    });
    assert.equal(initialRes.status, 200, 'User should be authorized initially on Instance 1');

    // Deactivate user in database
    await platformDb.query(
      `UPDATE core.users SET is_active = false WHERE user_id = $1`,
      [weighUser.userId]
    );

    // In a multi-node deployment, Instance 2 has its own memory space.
    // Clear Instance 1 local in-process cache to simulate inter-node boundary.
    clearAuthUserCache(weighUser.userId);

    // Immediate request on Instance 2 must be rejected with 401
    const afterRes = await fetch(`${baseUrl2}/api/v1/me`, {
      headers: { authorization: `Bearer ${weighToken}` },
    });
    assert.equal(
      afterRes.status,
      401,
      'Instance 2 must immediately reject deactivated user token with 401'
    );
    const errBody = (await afterRes.json()) as { error?: { message?: string } };
    assert.match(
      errBody.error?.message ?? '',
      /deactivated/i,
      'Error message must indicate account is deactivated'
    );

    // Re-activate user for clean state
    await platformDb.query(
      `UPDATE core.users SET is_active = true WHERE user_id = $1`,
      [weighUser.userId]
    );
  });

  await t.test('4. Node Crash & Fresh Node Restart Replay', async () => {
    // Close Instance 1 (simulating crash / shutdown)
    await new Promise<void>((resolve) => server1.close(() => resolve()));

    // Boot a fresh third instance connected to the same DB
    const app3 = createApiApp(db, undefined, platformDb);
    const server3: Server = await new Promise((resolve) => {
      const s = app3.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr3 = server3.address();
    const port3 = typeof addr3 === 'object' && addr3 ? addr3.port : 0;
    const baseUrl3 = `http://127.0.0.1:${port3}`;

    // Instance 3 immediately serves requests and verifies ledger state seamlessly
    const verifyRes = await fetch(`${baseUrl3}/api/v1/ledger/verify`, {
      headers: { authorization: `Bearer ${acctToken}` },
    });
    assert.equal(verifyRes.status, 200, 'Fresh Instance 3 must immediately verify ledger');
    const verifyData = (await verifyRes.json()) as { verified: boolean };
    assert.equal(verifyData.verified, true);

    await new Promise<void>((resolve) => server3.close(() => resolve()));
  });

  await new Promise<void>((resolve) => server2.close(() => resolve()));
  await close();
});
