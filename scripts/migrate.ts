import { config } from '../src/server/config.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { runSqlMigrations, verifySqlMigrations } from '../src/server/platform/seed.ts';
import { logger } from '../src/server/platform/logger.ts';

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify');
  const dbUrl = config.DATABASE_PLATFORM_URL || config.DATABASE_URL;
  const db =
    dbUrl && dbUrl.startsWith('postgres')
      ? new PgPoolAdapter(dbUrl)
      : new PGliteAdapter(config.PGLITE_DATA_DIR);

  try {
    if (verifyOnly) {
      const res = await verifySqlMigrations(db);
      logger.info('Database migrations verified', {
        verifiedCount: res.verifiedCount,
      });
    } else {
      const res = await runSqlMigrations(db);
      logger.info('Database migrations complete (with pg_advisory_lock)', {
        appliedCount: res.appliedCount,
        total: res.migrations.length,
      });
    }
  } finally {
    await db.close();
  }
}

void main();
