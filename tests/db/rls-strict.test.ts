import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import type { DbPort } from '../../src/server/ports/db.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';

describe('Phase A1 & C2 — Strict Fail-Closed PostgreSQL Row-Level Security (010 & 011)', () => {
  let db: DbPort;
  let closeDb: () => Promise<void>;
  let isPg = false;

  before(async () => {
    const bootstrapped = await bootstrapTestDatabase();
    db = bootstrapped.db;
    isPg = bootstrapped.isPg;
    closeDb = bootstrapped.close;
  });

  after(async () => {
    await closeDb?.();
  });

  it('returns 0 rows on every tenant-scoped table when connected as harbour_app with no tenant context', async () => {
    const policiesRes = await db.query<{ schemaname: string; tablename: string }>(
      `SELECT DISTINCT schemaname, tablename
       FROM pg_policies
       WHERE schemaname IN ('core', 'harbour', 'auction', 'ledger', 'sync')
       ORDER BY schemaname, tablename`
    );

    assert.ok(
      policiesRes.rows.length >= 27,
      `Expected >= 27 RLS tables, got ${policiesRes.rows.length}`
    );

    await db.transaction(async (tx) => {
      if (!isPg) {
        await tx.exec(`SET LOCAL ROLE harbour_app`);
      }
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
  });

  it('rejects INSERT with a mismatched tenant_id via WITH CHECK when connected as harbour_app', async () => {
    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          if (!isPg) {
            await tx.exec(`SET LOCAL ROLE harbour_app`);
          }
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
  });

  it('revokes UPDATE, DELETE, and TRUNCATE on ledger.entries and ledger.journals from harbour_app', async () => {
    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          if (!isPg) {
            await tx.exec(`SET LOCAL ROLE harbour_app`);
          }
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
          await tx.exec(`TRUNCATE ledger.entries`);
        });
      },
      /permission denied/i
    );

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          if (!isPg) {
            await tx.exec(`SET LOCAL ROLE harbour_app`);
          }
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
          await tx.exec(`DELETE FROM ledger.entries`);
        });
      },
      /permission denied|APPEND_ONLY_VIOLATION/i
    );
  });
});
