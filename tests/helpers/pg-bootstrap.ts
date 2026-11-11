import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../../src/server/adapters/db-pg.ts';
import {
  DEMO_TENANT_ID,
  runMigrationsAndSeed,
  seedDemo,
} from '../../src/server/platform/seed.ts';
import type { DbPort } from '../../src/server/ports/db.ts';

export interface BootstrappedTestDb {
  db: DbPort;
  platformDb: DbPort;
  isPg: boolean;
  close: () => Promise<void>;
}

/**
 * Shared test bootstrap for DB and API suites (Round 4 Phase B3).
 *
 * - Postgres mode (`DATABASE_URL` or `DATABASE_URL_TEST` set):
 *   1. Verifies app connection is `harbour_app` (`rolsuper=false`, `rolbypassrls=false`).
 *   2. Never runs DDL migrations; verifies all `db/migrations/*.sql` are recorded in `core.schema_migrations`
 *      and throws `"run \`npm run migrate\` first"` if not.
 *   3. Runs `await seedDemo(platformDb)` idempotently with zero swallowing `try/catch`.
 *   4. Asserts demo tenant (`munambam-demo`), >= 9 demo users, and >= 12 demo ledger entries exist.
 * - PGlite mode:
 *   Runs `runMigrationsAndSeed(memDb)` on an in-memory instance.
 */
export async function bootstrapTestDatabase(): Promise<BootstrappedTestDb> {
  const testUrl = process.env['DATABASE_URL_TEST'] || process.env['DATABASE_URL'];
  const platformUrl =
    process.env['DATABASE_PLATFORM_URL_TEST'] || process.env['DATABASE_PLATFORM_URL'];

  if (testUrl && testUrl.startsWith('postgres')) {
    if (!platformUrl || !platformUrl.startsWith('postgres')) {
      throw new Error(
        'FATAL [pg-bootstrap]: DATABASE_PLATFORM_URL must be set alongside DATABASE_URL when running PostgreSQL tests.'
      );
    }

    const db = new PgPoolAdapter(testUrl);
    const platformDb = new PgPoolAdapter(platformUrl);

    try {
      // 1. Assert app connection is harbour_app, rolsuper=false, rolbypassrls=false
      const roleRes = await db.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
      );
      assert.deepEqual(
        roleRes.rows[0],
        {
          current_user: 'harbour_app',
          rolsuper: false,
          rolbypassrls: false,
        },
        `Expected DATABASE_URL connection to be harbour_app (rolsuper=false, rolbypassrls=false), got ${JSON.stringify(roleRes.rows[0])}`
      );

      // 2. Assert schema is current (all migration files recorded in core.schema_migrations)
      const migDir = path.resolve(process.cwd(), 'db/migrations');
      const expectedFiles = fs
        .readdirSync(migDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      let appliedRows: ReadonlyArray<{ version: string }> = [];
      try {
        const migRes = await platformDb.query<{ version: string }>(
          `SELECT version FROM core.schema_migrations ORDER BY version ASC`
        );
        appliedRows = migRes.rows;
      } catch (err: unknown) {
        const pgCode = (err as { code?: string })?.code;
        if (pgCode === '42P01' || pgCode === '3F000') {
          throw new Error(
            'Database schema is not initialized (core.schema_migrations missing): run `npm run migrate` first'
          );
        }
        throw err;
      }

      const appliedSet = new Set(appliedRows.map((r) => r.version));
      const missing = expectedFiles.filter((f) => !appliedSet.has(f));
      if (missing.length > 0) {
        throw new Error(
          `Database schema is out of date (missing migrations: ${missing.join(', ')}): run \`npm run migrate\` first`
        );
      }

      // 3. Seed demo data idempotently as harbour_platform (never swallow errors)
      await seedDemo(platformDb);

      // 4. Verify seeded state (demo tenant, >= 9 demo users, >= 12 demo ledger entries)
      const tenantCheck = await platformDb.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM core.tenants WHERE tenant_id = $1`,
        [DEMO_TENANT_ID]
      );
      if (tenantCheck.rows.length !== 1) {
        throw new Error(
          `FATAL [pg-bootstrap]: Expected demo tenant '${DEMO_TENANT_ID}' after seedDemo, found ${tenantCheck.rows.length} rows`
        );
      }

      const userCountRes = await platformDb.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM core.users WHERE tenant_id = $1`,
        [DEMO_TENANT_ID]
      );
      const userCount = userCountRes.rows[0]?.cnt ?? 0;
      if (userCount < 9) {
        throw new Error(
          `FATAL [pg-bootstrap]: Expected >= 9 demo users in '${DEMO_TENANT_ID}', found ${userCount}`
        );
      }

      const entryCountRes = await platformDb.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM ledger.entries WHERE tenant_id = $1`,
        [DEMO_TENANT_ID]
      );
      const entryCount = entryCountRes.rows[0]?.cnt ?? 0;
      if (entryCount < 12) {
        throw new Error(
          `FATAL [pg-bootstrap]: Expected >= 12 demo ledger entries in '${DEMO_TENANT_ID}', found ${entryCount}`
        );
      }

      return {
        db,
        platformDb,
        isPg: true,
        close: async () => {
          await db.close();
          await platformDb.close();
        },
      };
    } catch (err) {
      await db.close();
      await platformDb.close();
      throw err;
    }
  }

  const memDb = new PGliteAdapter('memory://');
  await runMigrationsAndSeed(memDb);
  return {
    db: memDb,
    platformDb: memDb,
    isPg: false,
    close: async () => {
      await memDb.close();
    },
  };
}
