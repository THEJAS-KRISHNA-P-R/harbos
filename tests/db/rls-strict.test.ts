import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGliteAdapter } from '../../src/server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '../../src/server/adapters/db-pg.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import type { DbPort } from '../../src/server/ports/db.ts';

async function createTestDb(): Promise<DbPort> {
  const testUrl = process.env['DATABASE_URL_TEST'];
  if (testUrl && testUrl.startsWith('postgres')) {
    return new PgPoolAdapter(testUrl);
  }
  return new PGliteAdapter('memory://');
}

describe('Phase A1 — Strict Fail-Closed PostgreSQL Row-Level Security (010_rls_strict.sql)', () => {
  it('returns 0 rows on every tenant-scoped table when connected as harbour_app with no tenant context', async () => {
    const db = await createTestDb();
    await runMigrationsAndSeed(db);

    const policiesRes = await db.query<{ schemaname: string; tablename: string }>(
      `SELECT DISTINCT schemaname, tablename
       FROM pg_policies
       WHERE schemaname IN ('core', 'harbour', 'auction', 'ledger', 'sync')
       ORDER BY schemaname, tablename`
    );

    assert.ok(policiesRes.rows.length >= 19, `Expected >= 19 RLS tables, got ${policiesRes.rows.length}`);

    await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE harbour_app`);
      await tx.query(
        `SELECT set_config('app.tenant_id', '', true), set_config('app.platform', '', true)`
      );

      for (const { schemaname, tablename } of policiesRes.rows) {
        const countRes = await tx.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM ${schemaname}.${tablename}`
        );
        assert.equal(
          Number(countRes.rows[0]?.cnt ?? -1),
          0,
          `Table ${schemaname}.${tablename} leaked ${countRes.rows[0]?.cnt} rows with no tenant context!`
        );
      }
    });

    await db.close?.();
  });

  it('rejects INSERT with a mismatched tenant_id via WITH CHECK when connected as harbour_app', async () => {
    const db = await createTestDb();
    await runMigrationsAndSeed(db);

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE harbour_app`);
          await tx.query(
            `SELECT set_config('app.tenant_id', $1, true), set_config('app.platform', '', true)`,
            [DEMO_TENANT_ID]
          );
          await tx.query(
            `INSERT INTO harbour.coop_societies (society_id, tenant_id, reg_no, name_en, name_ml)
             VALUES ('SOC-EVIL-1', 'kochi-thoppumpady', 'KL-EVIL', 'Evil Coop', 'ഈവിൽ')`
          );
        });
      },
      /new row violates row-level security policy/i
    );

    await db.close?.();
  });

  it('revokes UPDATE, DELETE, and TRUNCATE on ledger.entries and ledger.journals from harbour_app', async () => {
    const db = await createTestDb();
    await runMigrationsAndSeed(db);

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE harbour_app`);
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
          await tx.exec(`TRUNCATE ledger.entries`);
        });
      },
      /permission denied/i
    );

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE harbour_app`);
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
          await tx.exec(`DELETE FROM ledger.entries`);
        });
      },
      /permission denied|APPEND_ONLY_VIOLATION/i
    );

    await db.close?.();
  });
});
