import { config } from '@server/config.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { runDailyLedgerAnchorJob } from '@server/entry/jobs.ts';
import { runMigrationsAndSeed } from '@server/platform/seed.ts';

async function main() {
  const dbUrl = config.DATABASE_PLATFORM_URL || config.DATABASE_URL;
  const platformDb = dbUrl
    ? new PgPoolAdapter(dbUrl)
    : new PGliteAdapter('memory://');

  try {
    if (!dbUrl) {
      await runMigrationsAndSeed(platformDb);
    }
    const anchors = await runDailyLedgerAnchorJob(platformDb);
    console.log(
      JSON.stringify({
        ok: true,
        anchoredCount: anchors.length,
        anchors,
      })
    );
  } finally {
    if (platformDb.close) await platformDb.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
