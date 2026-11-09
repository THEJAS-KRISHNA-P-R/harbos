import fs from 'node:fs';
import path from 'node:path';
import { config } from '@server/config.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { runSqlMigrations } from '@server/platform/seed.ts';

async function main(): Promise<void> {
  const db = config.DATABASE_URL
    ? new PgPoolAdapter(config.DATABASE_URL)
    : new PGliteAdapter('memory://');

  console.log(
    `[migrate] Running HarbourOS SQL migration chain against ${
      config.DATABASE_URL ? 'PostgreSQL (pg.Pool)' : 'PGlite (PostgreSQL 16 WASM)'
    }...`
  );

  const firstRun = await runSqlMigrations(db);
  console.log(`[migrate] Pass 1 applied ${firstRun.appliedCount} migrations:`);
  for (const m of firstRun.migrations) {
    console.log(`  - ${m.version} [${m.status}] sha256=${m.checksum.slice(0, 16)}...`);
  }

  const secondRun = await runSqlMigrations(db);
  console.log(
    `[migrate] Pass 2 (idempotency check) applied ${secondRun.appliedCount} migrations (expected 0).`
  );
  if (secondRun.appliedCount !== 0) {
    console.error('[migrate] FAILED idempotency check: Pass 2 applied > 0 migrations');
    process.exit(1);
  }

  const migDir = path.resolve(process.cwd(), 'db/migrations');
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  console.log(`[migrate] Verified ${files.length} SQL migration files in db/migrations/.`);
}

main().catch((err) => {
  console.error('[migrate] Error:', err);
  process.exit(1);
});
