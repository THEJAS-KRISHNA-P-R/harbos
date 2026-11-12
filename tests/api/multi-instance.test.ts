import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../../src/server/app.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';
import type { DbPort } from '../../src/server/ports/db.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';

describe('Phase 2 Multi-Instance Concurrency, DB Idempotency & Rate Limit Suite', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let readDb: DbPort;
  let closeDb: () => Promise<void>;
  let server1: http.Server;
  let server2: http.Server;
  let baseUrl1 = '';
  let baseUrl2 = '';
  let weigherToken = '';
  let auctioneerToken = '';
  let accountantToken = '';

  before(async () => {
    const bootstrapped = await bootstrapTestDatabase();
    db = bootstrapped.db;
    platformDb = bootstrapped.platformDb;
    readDb = db;
    closeDb = bootstrapped.close;

    // Start App Instance 1
    const app1 = createApiApp(db, undefined, platformDb, readDb);
    await new Promise<void>((resolve) => {
      server1 = app1.listen(0, '127.0.0.1', () => {
        const addr = server1.address();
        if (addr && typeof addr === 'object') baseUrl1 = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Start App Instance 2 (sharing same database & platformDb)
    const app2 = createApiApp(db, undefined, platformDb, readDb);
    await new Promise<void>((resolve) => {
      server2 = app2.listen(0, '127.0.0.1', () => {
        const addr = server2.address();
        if (addr && typeof addr === 'object') baseUrl2 = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    weigherToken = await signAccessJwt({
      sub: 'USR-WEIGH-01',
      tenantId: DEMO_TENANT_ID,
      role: 'WEIGHING_OPERATOR',
      fullName: 'Sajeev K.',
      phoneE164: '+919447000101',
    });

    auctioneerToken = await signAccessJwt({
      sub: 'USR-AUCT-01',
      tenantId: DEMO_TENANT_ID,
      role: 'LICENSED_AUCTIONEER',
      fullName: 'K. Balakrishnan Nair',
      phoneE164: '+919447000102',
      entityRefId: 'LIC-MUN-001',
    });

    accountantToken = await signAccessJwt({
      sub: 'USR-ACCT-01',
      tenantId: DEMO_TENANT_ID,
      role: 'ACCOUNTANT',
      fullName: 'Deepa Krishnan',
      phoneE164: '+919447000104',
    });
  });

  after(async () => {
    if (server1) await new Promise<void>((resolve) => server1.close(() => resolve()));
    if (server2) await new Promise<void>((resolve) => server2.close(() => resolve()));
    await closeDb?.();
  });

  it('1-tx per request round-trip count: GET /api/v1/lots has X-DB-RoundTrips <= 5', async () => {
    const res = await fetch(`${baseUrl1}/api/v1/lots`, {
      headers: { Authorization: `Bearer ${weigherToken}` },
    });
    assert.equal(res.status, 200);
    const rt = Number(res.headers.get('x-db-roundtrips') ?? '999');
    assert.ok(rt <= 5, `Expected X-DB-RoundTrips <= 5 for GET /api/v1/lots, got ${rt}`);
  });

  it('2-instance DB idempotency: first request to instance 1, replay to instance 2 returns identical response', async () => {
    const idemKey = `MULTI-INST-IDEM-${Date.now()}`;

    // Request to instance 1
    const res1 = await fetch(`${baseUrl1}/api/v1/buyers/BUY-01/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        amountPaise: '1000000',
        paymentChannel: 'NEFT',
        referenceNo: `REF-INST1-${Date.now()}`,
      }),
    });
    assert.equal(res1.status, 201);
    const body1 = (await res1.json()) as { receiptId: string; amountPaise: string };

    // Same request replay to instance 2
    const res2 = await fetch(`${baseUrl2}/api/v1/buyers/BUY-01/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accountantToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        amountPaise: '1000000',
        paymentChannel: 'NEFT',
        referenceNo: body1.receiptId,
      }),
    });
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { receiptId: string; amountPaise: string; idempotentReplay?: boolean };
    assert.equal(body2.receiptId, body1.receiptId);
    assert.equal(body2.idempotentReplay, true);
  });

  it('2-instance cross-instance auth rate limiting: 25 attempts split 13 (inst1) + 12 (inst2) allowed, 26th rejected 429', async () => {
    const probeIp = '198.51.100.77';

    // 13 attempts on Instance 1
    for (let i = 0; i < 13; i += 1) {
      const res = await fetch(`${baseUrl1}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': probeIp,
        },
        body: JSON.stringify({ phoneE164: '+919447000101' }),
      });
      assert.equal(res.status, 200);
    }

    // 12 attempts on Instance 2
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${baseUrl2}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': probeIp,
        },
        body: JSON.stringify({ phoneE164: '+919447000101' }),
      });
      assert.equal(res.status, 200);
    }

    // 26th attempt on Instance 1 must be rejected with 429
    const res26 = await fetch(`${baseUrl1}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': probeIp,
      },
      body: JSON.stringify({ phoneE164: '+919447000101' }),
    });
    assert.equal(res26.status, 429);
    const body26 = (await res26.json()) as { error: { code: string } };
    assert.equal(body26.error.code, 'RATE_LIMIT_EXCEEDED');
  });
});
