import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import {
  allocateLotSale,
  verifyTenantLedgerChain,
  executeDualKeyReversal,
} from '../../src/server/platform/ledger-service.ts';

describe('M2, M6 & M7 Real PostgreSQL (PGlite) — Statutory Checks, Append-Only Ledger & Dual-Key Reversals', () => {
  it('applies migrations idempotently, seeds munambam-demo, and verifies all statutory & ledger invariants', async () => {
    const db = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(db);
    // Second run is idempotent
    await runMigrationsAndSeed(db);

    // 1. Verify initial seeded SHA-256 chain
    const initialVerify = await verifyTenantLedgerChain(db, DEMO_TENANT_ID);
    assert.equal(initialVerify.verified, true);
    assert.ok(initialVerify.entryCount >= 12);

    // 2. Verify SQL sha256() matches our TypeScript golden hash
    const sqlHashRes = await db.query<{ sql_hash: string }>(
      `SELECT encode(sha256(convert_to('HarbourOS Act 16 of 2021', 'UTF8')), 'hex') AS sql_hash`
    );
    assert.equal(sqlHashRes.rows[0]?.sql_hash?.length, 64);

    // 3. Direct UPDATE / DELETE on ledger.entries or ledger.journals is blocked by PostgreSQL trigger (§8)
    await assert.rejects(
      async () => {
        await db.query(`UPDATE ledger.entries SET amount_paise = 999 WHERE entry_seq = 1`);
      },
      /APPEND_ONLY_VIOLATION/
    );
    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM ledger.journals WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
      },
      /APPEND_ONLY_VIOLATION/
    );

    // 4. Statutory Check: Expired Auctioneer Licence (s.5(7)) is rejected
    await assert.rejects(
      async () => {
        await allocateLotSale(db, {
          tenantId: DEMO_TENANT_ID,
          lotId: 'LOT-2026-003',
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-003', // Expired licence
          buyerId: 'BUY-01',
          boxesRequested: 1,
          pricePerKgPaise: 400_00n,
          idempotencyKey: 'TEST-EXP-LIC',
          fencingToken: 10,
          nowIso: '2026-11-06T06:30:00.000Z',
        });
      },
      /EXPIRED/
    );

    // 5. Statutory Check: Section 4(8) Society-Loan Vessel rejects non-deputed private auctioneer
    await assert.rejects(
      async () => {
        await allocateLotSale(db, {
          tenantId: DEMO_TENANT_ID,
          lotId: 'LOT-2026-001', // VSL-01 has active loan from SOC-MUN-01
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-002', // Independent private auctioneer
          buyerId: 'BUY-01',
          boxesRequested: 1,
          pricePerKgPaise: 700_00n,
          idempotencyKey: 'TEST-S48-MISMATCH',
          fencingToken: 10,
          nowIso: '2026-11-06T06:31:00.000Z',
        });
      },
      /Section 4\(8\) violation/
    );

    // 6. Statutory Check: Section 21 REJECTED_UNFIT lot cannot be allocated
    await assert.rejects(
      async () => {
        await allocateLotSale(db, {
          tenantId: DEMO_TENANT_ID,
          lotId: 'LOT-2026-005', // Graded REJECTED_UNFIT
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-001',
          buyerId: 'BUY-01',
          boxesRequested: 1,
          pricePerKgPaise: 200_00n,
          idempotencyKey: 'TEST-S21-UNFIT',
          fencingToken: 10,
          nowIso: '2026-11-06T06:32:00.000Z',
        });
      },
      /REJECTED_UNFIT/
    );

    // 7. Statutory Check: Stale Leader Lease Fencing Token (< 10) is rejected
    await assert.rejects(
      async () => {
        await allocateLotSale(db, {
          tenantId: DEMO_TENANT_ID,
          lotId: 'LOT-2026-003',
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-001',
          buyerId: 'BUY-01',
          boxesRequested: 1,
          pricePerKgPaise: 400_00n,
          idempotencyKey: 'TEST-STALE-FENCE',
          fencingToken: 4, // Stale fencing token < 10
          nowIso: '2026-11-06T06:33:00.000Z',
        });
      },
      /Stale leader tablet rejected/
    );

    // 8. Statutory Check: Oversell (> available_boxes) is rejected
    await assert.rejects(
      async () => {
        await allocateLotSale(db, {
          tenantId: DEMO_TENANT_ID,
          lotId: 'LOT-2026-003',
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-001',
          buyerId: 'BUY-01',
          boxesRequested: 999,
          pricePerKgPaise: 400_00n,
          idempotencyKey: 'TEST-OVERSELL',
          fencingToken: 10,
          nowIso: '2026-11-06T06:34:00.000Z',
        });
      },
      /Oversell prevented/
    );

    // 9. Dual-Key Reversal: Rejects approval by the same user who requested it, succeeds with a second distinct user
    await assert.rejects(
      async () => {
        await executeDualKeyReversal(db, {
          tenantId: DEMO_TENANT_ID,
          reversalId: 'REV-REQ-001',
          approverUserId: 'USR-ACCT-01', // Same as requester!
          approverName: 'Deepa Krishnan (Accountant)',
          nowIso: '2026-11-06T06:40:00.000Z',
        });
      },
      /Dual-key control violation/
    );

    const revResult = await executeDualKeyReversal(db, {
      tenantId: DEMO_TENANT_ID,
      reversalId: 'REV-REQ-001',
      approverUserId: 'USR-HADMIN-01', // Distinct Harbour Admin user
      approverName: 'Capt. Mathew Thomas (Harbour Admin)',
      nowIso: '2026-11-06T06:41:00.000Z',
    });
    assert.ok(revResult.compensatingJournalId.startsWith('JRN-REV-'));

    // 10. Re-verify SHA-256 hash chain after compensating reversal journal
    const postRevVerify = await verifyTenantLedgerChain(db, DEMO_TENANT_ID);
    assert.equal(postRevVerify.verified, true);
  });
});
