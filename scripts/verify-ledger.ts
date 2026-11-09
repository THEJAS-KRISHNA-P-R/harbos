import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import { verifyTenantLedgerChain } from '../src/server/platform/ledger-service.ts';

async function main(): Promise<void> {
  const db = new PGliteAdapter('memory://');
  await runMigrationsAndSeed(db);
  const res = await verifyTenantLedgerChain(db, DEMO_TENANT_ID);
  console.log(JSON.stringify(res, null, 2));
  if (!res.verified) {
    process.exit(1);
  }
}

void main();
