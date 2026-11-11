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
CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD '<HARBOUR_PLATFORM_PASSWORD>';
`.trim();

async function ensurePostgresRoles(db: PgPoolAdapter): Promise<void> {
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
    await db.query(
      `CREATE ROLE harbour_platform LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`
    );
    logger.info('Created database role harbour_platform (BYPASSRLS)');
  }
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify');
  const withSeed = process.argv.includes('--seed');
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
        await ensurePostgresRoles(db);
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

      if (isPg) {
        await db.query(
          `ALTER ROLE harbour_app WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
        );
        await db.query(
          `ALTER ROLE harbour_platform WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`
        );

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
