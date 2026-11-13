import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed } from '../../src/server/platform/seed.ts';
import { createApiApp } from '../../src/server/app.ts';
import { createIsolatedTenant } from '../helpers/fixtures.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';

describe('B1: Multi-Tenant Prefix Collision & Unique Allocation/Journal IDs', () => {
  let db: PGliteAdapter;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    db = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(db);

    const app = createApiApp(db, undefined, db);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it('two tenants sharing same 3-letter prefix ("mun-a" and "mun-b") each allocate their first lot without duplicate key collision', async () => {
    const tenantA = await createIsolatedTenant(db, 'mun-a');
    const tenantB = await createIsolatedTenant(db, 'mun-b');

    // Both tenants have prefixes that start with 'mun'
    assert.equal(tenantA.slug.slice(0, 3), 'mun');
    assert.equal(tenantB.slug.slice(0, 3), 'mun');

    const weigherA = tenantA.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspectorA = tenantA.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctioneerA = tenantA.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;

    const weigherB = tenantB.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspectorB = tenantB.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctioneerB = tenantB.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;

    const tokenWeigherA = await signAccessJwt({
      sub: weigherA.userId,
      tenantId: tenantA.tenantId,
      role: weigherA.role,
      fullName: weigherA.fullName,
      phoneE164: weigherA.phoneE164,
    });
    const tokenInspectorA = await signAccessJwt({
      sub: inspectorA.userId,
      tenantId: tenantA.tenantId,
      role: inspectorA.role,
      fullName: inspectorA.fullName,
      phoneE164: inspectorA.phoneE164,
    });
    const tokenAuctioneerA = await signAccessJwt({
      sub: auctioneerA.userId,
      tenantId: tenantA.tenantId,
      role: auctioneerA.role,
      fullName: auctioneerA.fullName,
      phoneE164: auctioneerA.phoneE164,
    });

    const tokenWeigherB = await signAccessJwt({
      sub: weigherB.userId,
      tenantId: tenantB.tenantId,
      role: weigherB.role,
      fullName: weigherB.fullName,
      phoneE164: weigherB.phoneE164,
    });
    const tokenInspectorB = await signAccessJwt({
      sub: inspectorB.userId,
      tenantId: tenantB.tenantId,
      role: inspectorB.role,
      fullName: inspectorB.fullName,
      phoneE164: inspectorB.phoneE164,
    });
    const tokenAuctioneerB = await signAccessJwt({
      sub: auctioneerB.userId,
      tenantId: tenantB.tenantId,
      role: auctioneerB.role,
      fullName: auctioneerB.fullName,
      phoneE164: auctioneerB.phoneE164,
    });

    // 1. Tenant A weighs and inspects lot 1
    const lotARes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWeigherA}` },
      body: JSON.stringify({
        vesselId: `VES-${tenantA.tenantId}-01`,
        speciesId: tenantA.speciesId,
        totalBoxes: 5,
        netGrams: '150000',
        coreTempC: 1.5,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotARes.status, 201);
    const lotA = (await lotARes.json()) as { lotId: string; lotCode: string };

    const inspARes = await fetch(`${baseUrl}/api/v1/lots/${lotA.lotId}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenInspectorA}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.5 }),
    });
    assert.equal(inspARes.status, 200);

    // 2. Tenant B weighs and inspects lot 1
    const lotBRes = await fetch(`${baseUrl}/api/v1/lots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWeigherB}` },
      body: JSON.stringify({
        vesselId: `VES-${tenantB.tenantId}-01`,
        speciesId: tenantB.speciesId,
        totalBoxes: 5,
        netGrams: '150000',
        coreTempC: 1.5,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(lotBRes.status, 201);
    const lotB = (await lotBRes.json()) as { lotId: string; lotCode: string };

    const inspBRes = await fetch(`${baseUrl}/api/v1/lots/${lotB.lotId}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenInspectorB}` },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.5 }),
    });
    assert.equal(inspBRes.status, 200);

    // 3. Tenant A allocates lot 1
    const allocARes = await fetch(`${baseUrl}/api/v1/lots/${lotA.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAuctioneerA}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: tenantA.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: `LIC-${tenantA.tenantId}-01`,
        buyerId: tenantA.buyerId,
        boxesAllocated: 2,
        pricePerKgPaise: '45000',
        fencingToken: 1,
      }),
    });
    assert.equal(allocARes.status, 201, `Tenant A allocate failed with status ${allocARes.status}`);
    const allocA = (await allocARes.json()) as { allocationId: string; journalId: string };

    // 4. Tenant B allocates lot 1 (must NOT 500 with duplicate key value on journals_pkey / allocations)
    const allocBRes = await fetch(`${baseUrl}/api/v1/lots/${lotB.lotId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAuctioneerB}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        sessionId: tenantB.sessionId,
        auctionMode: 'PHYSICAL_SHOUT',
        auctioneerLicenceId: `LIC-${tenantB.tenantId}-01`,
        buyerId: tenantB.buyerId,
        boxesAllocated: 2,
        pricePerKgPaise: '45000',
        fencingToken: 1,
      }),
    });
    assert.equal(allocBRes.status, 201, `Tenant B allocate failed with status ${allocBRes.status}: duplicate PK collision`);
    const allocB = (await allocBRes.json()) as { allocationId: string; journalId: string };

    assert.notEqual(allocA.allocationId, allocB.allocationId);
    assert.notEqual(allocA.journalId, allocB.journalId);
    assert.notEqual(lotA.lotCode, lotB.lotCode);
  });
});
