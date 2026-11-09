import { config } from '@server/config.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '@server/platform/seed.ts';

async function main(): Promise<void> {
  const db = config.DATABASE_URL
    ? new PgPoolAdapter(config.DATABASE_URL)
    : new PGliteAdapter('memory://');

  await runMigrationsAndSeed(db);

  const tenants = await db.query(`SELECT * FROM core.tenants WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
  const lots = await db.query(`SELECT * FROM auction.lots WHERE tenant_id = $1 ORDER BY lot_code`, [DEMO_TENANT_ID]);
  const allocations = await db.query(`SELECT * FROM auction.sale_allocations WHERE tenant_id = $1 ORDER BY allocation_id`, [DEMO_TENANT_ID]);
  const journals = await db.query(`SELECT * FROM ledger.journals WHERE tenant_id = $1 ORDER BY created_at`, [DEMO_TENANT_ID]);
  const entries = await db.query(`SELECT * FROM ledger.entries WHERE tenant_id = $1 ORDER BY entry_seq`, [DEMO_TENANT_ID]);

  const payload = {
    exportedAt: new Date().toISOString(),
    tenantId: DEMO_TENANT_ID,
    counts: {
      tenants: tenants.rows.length,
      lots: lots.rows.length,
      allocations: allocations.rows.length,
      journals: journals.rows.length,
      entries: entries.rows.length,
    },
    data: {
      tenants: tenants.rows,
      lots: lots.rows,
      allocations: allocations.rows,
      journals: journals.rows,
      entries: entries.rows,
    },
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error('[export-data] Error:', err);
  process.exit(1);
});
