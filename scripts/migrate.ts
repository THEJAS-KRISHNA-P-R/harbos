import { config } from '../src/server/config.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import {
  runSqlMigrations,
  verifySqlMigrations,
  runMigrationsAndSeed,
} from '../src/server/platform/seed.ts';
import { logger } from '../src/server/platform/logger.ts';

const DBA_ROLE_PROVISION_SQL = `
-- Run as PostgreSQL superuser / cluster admin before running migrations:
CREATE ROLE harbour_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<HARBOUR_APP_PASSWORD>';
-- Option A (self-hosted PostgreSQL with BYPASSRLS):
CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD '<HARBOUR_PLATFORM_PASSWORD>';
-- Option B (managed PostgreSQL / Cloud SQL where BYPASSRLS is restricted; set RLS_PLATFORM_MODE=owner):
CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<HARBOUR_PLATFORM_PASSWORD>';
`.trim();

async function ensurePostgresRoles(
  db: PgPoolAdapter,
  rlsPlatformMode: 'bypassrls' | 'owner'
): Promise<void> {
  const existing = await db.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('harbour_app', 'harbour_platform')`
  );
  const found = new Set(existing.rows.map((r) => r.rolname));
  const missingApp = !found.has('harbour_app');
  const missingPlatform = !found.has('harbour_platform');

  if (!missingApp && !missingPlatform) {
    return;
  }

  const privRes = await db.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
    `SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user`
  );
  const priv = privRes.rows[0];
  if (!priv || (!priv.rolsuper && !priv.rolcreaterole)) {
    console.error(
      '[migrate] ERROR: Database roles harbour_app and/or harbour_platform are missing, and current_user lacks CREATEROLE/SUPERUSER privileges.\n' +
        'Ask your DBA to run the following SQL first:\n\n' +
        DBA_ROLE_PROVISION_SQL
    );
    process.exit(1);
  }

  if (missingApp) {
    await db.query(
      `CREATE ROLE harbour_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
    );
    logger.info('Created database role harbour_app (NOBYPASSRLS)');
  }
  if (missingPlatform) {
    const bypassAttr = rlsPlatformMode === 'bypassrls' ? 'BYPASSRLS' : 'NOBYPASSRLS';
    try {
      await db.query(
        `CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE ${bypassAttr}`
      );
      logger.info(`Created database role harbour_platform (${bypassAttr})`);
    } catch {
      await db.query(
        `CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
      );
      logger.info('Created database role harbour_platform (NOBYPASSRLS fallback)');
    }
  }
}

async function applyOwnerRlsMode(db: PgPoolAdapter): Promise<void> {
  const schemas = ['core', 'harbour', 'auction', 'ledger', 'sync'];
  for (const s of schemas) {
    await db.query(`GRANT ALL ON SCHEMA ${s} TO harbour_platform`);
  }
  const tables = await db.query<{ schemaname: string; tablename: string }>(
    `SELECT schemaname, tablename
     FROM pg_tables
     WHERE schemaname IN ('core', 'harbour', 'auction', 'ledger', 'sync')`
  );
  for (const t of tables.rows) {
    const fq = `${t.schemaname}.${t.tablename}`;
    await db.query(`ALTER TABLE ${fq} OWNER TO harbour_platform`);
    await db.query(`ALTER TABLE ${fq} NO FORCE ROW LEVEL SECURITY`);
  }
  logger.info('Configured RLS_PLATFORM_MODE=owner (table ownership transferred to harbour_platform, NO FORCE RLS)');
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify');
  const withSeed = process.argv.includes('--seed');
  const rlsPlatformMode =
    (process.env.RLS_PLATFORM_MODE as 'bypassrls' | 'owner' | undefined) ??
    config.RLS_PLATFORM_MODE ??
    'bypassrls';
  const dbUrl =
    process.env.DATABASE_PLATFORM_URL ||
    process.env.DATABASE_URL ||
    config.DATABASE_PLATFORM_URL ||
    config.DATABASE_URL;
  const isPg = Boolean(dbUrl && dbUrl.startsWith('postgres'));
  const db = isPg
    ? new PgPoolAdapter(dbUrl)
    : new PGliteAdapter(config.PGLITE_DATA_DIR);

  try {
    if (verifyOnly) {
      const res = await verifySqlMigrations(db);
      logger.info('Database migrations verified', {
        verifiedCount: res.verifiedCount,
      });
    } else {
      if (isPg && db instanceof PgPoolAdapter) {
        await ensurePostgresRoles(db, rlsPlatformMode);
      }

      if (withSeed) {
        await runMigrationsAndSeed(db);
        logger.info('Database migrations and demo seed complete');
      } else {
        const res = await runSqlMigrations(db);
        logger.info('Database migrations complete (with pg_advisory_lock)', {
          appliedCount: res.appliedCount,
          total: res.migrations.length,
        });
      }

      if (isPg && db instanceof PgPoolAdapter) {
        await db.query(
          `ALTER ROLE harbour_app WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
        );
        if (rlsPlatformMode === 'owner') {
          await db.query(
            `ALTER ROLE harbour_platform WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
          );
          await applyOwnerRlsMode(db);
        } else {
          try {
            await db.query(
              `ALTER ROLE harbour_platform WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`
            );
          } catch {
            logger.warn(
              'BYPASSRLS unavailable on managed PostgreSQL; falling back to RLS_PLATFORM_MODE=owner'
            );
            await applyOwnerRlsMode(db);
          }
        }

        if (process.env.HARBOUR_APP_PASSWORD) {
          const safePass = process.env.HARBOUR_APP_PASSWORD.replace(/'/g, "''");
          await db.query(`ALTER ROLE harbour_app WITH PASSWORD '${safePass}'`);
          logger.info('Provisioned password for database role harbour_app');
        }
        if (process.env.HARBOUR_PLATFORM_PASSWORD) {
          const safePass = process.env.HARBOUR_PLATFORM_PASSWORD.replace(/'/g, "''");
          await db.query(`ALTER ROLE harbour_platform WITH PASSWORD '${safePass}'`);
          logger.info('Provisioned password for database role harbour_platform');
        }
      }
    }
  } finally {
    await db.close();
  }
}

void main();
