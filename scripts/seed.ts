import { config } from '@server/config.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '@server/platform/seed.ts';
import { verifyTenantLedgerChain } from '@server/platform/ledger-service.ts';

async function main(): Promise<void> {
  const db = config.DATABASE_URL
    ? new PgPoolAdapter(config.DATABASE_URL)
    : new PGliteAdapter('memory://');

  await runMigrationsAndSeed(db);
  const chain = await verifyTenantLedgerChain(db, DEMO_TENANT_ID);
  console.log(
    `[seed] Seeded tenant "${DEMO_TENANT_ID}" — SHA-256 chain verified=${chain.verified} entries=${chain.entryCount} head=${chain.headHash}`
  );
}

main().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
