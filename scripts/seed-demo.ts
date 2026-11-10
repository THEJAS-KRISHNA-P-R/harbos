import { config } from '../src/server/config.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { runMigrationsAndSeed } from '../src/server/platform/seed.ts';
import { logger } from '../src/server/platform/logger.ts';

async function main(): Promise<void> {
  if (config.NODE_ENV === 'production' || !config.DEMO_MODE) {
    throw new Error('Refusing to run demo seed when NODE_ENV=production or DEMO_MODE=false');
  }

  const db =
    config.DATABASE_URL && config.DATABASE_URL.startsWith('postgres')
      ? new PgPoolAdapter(config.DATABASE_URL)
      : new PGliteAdapter(config.PGLITE_DATA_DIR);

  try {
    await runMigrationsAndSeed(db);
    logger.info('Demo harbour seed complete');
  } finally {
    await db.close();
  }
}

void main();
