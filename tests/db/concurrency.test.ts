import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { allocateLotSale, verifyTenantLedgerChain } from '../../src/server/modules/ledger/index.ts';
import { createPayoutBatch, recordBuyerReceipt } from '../../src/server/modules/payouts/index.ts';
import type { DbPort } from '../../src/server/ports/db.ts';

describe('Phase 2.7 Concurrency Property Suite & Hot-Row Fillfactor Verification', () => {
  let db: DbPort;

  before(async () => {
    const memDb = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(memDb);
    db = memDb;
  });

  after(async () => {
    if (db.close) await db.close();
  });

  it('Verifies hot-row fillfactor=50 storage options are configured in migration 012 on hot tables', async () => {
    const hotTables = [
      'ledger.heads',
      'ledger.accounts',
      'auction.sessions',
      'harbour.buyers',
    ];

    for (const tbl of hotTables) {
      const [schema, name] = tbl.split('.');
      const res = await db.query<{ reloptions: string[] | null }>(
        `SELECT c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema, name]
      );
      assert.ok(res.rows.length > 0, `Table ${tbl} must exist`);
      const options = res.rows[0]?.reloptions ?? [];
      const hasFillfactor50 = options.some((opt: string) => opt.includes('fillfactor=50'));
      assert.ok(hasFillfactor50, `Table ${tbl} must have fillfactor=50 set in reloptions, got: ${JSON.stringify(options)}`);
    }
  });

  it('Runs concurrent ledger operations and verifies zero deadlocks and SHA-256 chain integrity', async () => {
    // 5 concurrent buyer receipts on BUY-01
    const receiptPromises = Array.from({ length: 5 }, (_, i) =>
      recordBuyerReceipt(db, {
        tenantId: DEMO_TENANT_ID,
        actorUserId: 'USR-ACCT-01',
        actorFullName: 'Deepa Krishnan',
        actorRole: 'ACCOUNTANT',
        buyerId: 'BUY-01',
        amountPaise: 500000n,
        paymentChannel: 'NEFT',
        referenceNo: `NEFT-CONCURR-${i}-${Date.now()}`,
        idempotencyKey: `CONCURR-RCPT-${i}-${Date.now()}`,
      })
    );

    const results = await Promise.all(receiptPromises);
    assert.equal(results.length, 5);

    // Verify chain is intact after concurrent operations
    const chain = await verifyTenantLedgerChain(db, DEMO_TENANT_ID);
    assert.equal(chain.verified, true);
    assert.ok(chain.entryCount >= 17);
  });
});
