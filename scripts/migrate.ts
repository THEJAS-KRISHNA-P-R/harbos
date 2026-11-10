import { config } from '../src/server/config.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { runSqlMigrations } from '../src/server/platform/seed.ts';
import { logger } from '../src/server/platform/logger.ts';

async function main(): Promise<void> {
  const db =
    config.DATABASE_URL && config.DATABASE_URL.startsWith('postgres')
      ? new PgPoolAdapter(config.DATABASE_URL)
      : new PGliteAdapter(config.PGLITE_DATA_DIR);

  try {
    const res = await runSqlMigrations(db);
    logger.info('Database migrations complete', {
      appliedCount: res.appliedCount,
      total: res.migrations.length,
    });
  } finally {
    await db.close();
  }
}

void main();
