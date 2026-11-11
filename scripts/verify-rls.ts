import assert from 'node:assert/strict';
import { config } from '../src/server/config.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import type { DbPort } from '../src/server/ports/db.ts';

const TENANT_TABLES: ReadonlyArray<string> = [
  'core.tenants',
  'core.users',
  'core.sessions',
  'core.commission_policies',
  'core.audit_logs',
  'core.sdk_api_keys',
  'harbour.coop_societies',
  'harbour.fishermen',
  'harbour.vessels',
  'harbour.auctioneer_licences',
  'harbour.buyers',
  'harbour.species',
  'auction.sessions',
  'auction.lots',
  'auction.sale_allocations',
  'auction.leader_leases',
  'ledger.heads',
  'ledger.accounts',
  'ledger.journals',
  'ledger.entries',
  'ledger.payout_batches',
  'ledger.payout_batch_items',
  'ledger.reversal_requests',
  'ledger.daily_anchors',
  'ledger.verifications',
  'ledger.buyer_receipts',
  'sync.client_commands',
  'sync.outbox_events',
  'sync.webhook_deliveries',
];

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || config.DATABASE_URL;
  let db: DbPort;
  let isPg = false;

  if (dbUrl && dbUrl.startsWith('postgres')) {
    db = new PgPoolAdapter(dbUrl);
    isPg = true;
  } else {
    db = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(db);
  }

  try {
    console.log('[verify-rls] Starting RLS and least-privilege audit...');

    // 1. Role verification if connected to real PostgreSQL
    if (isPg) {
      const roleRes = await db.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r
         WHERE r.rolname = current_user`
      );
      const role = roleRes.rows[0];
      assert.ok(role, 'Must resolve current_user from pg_roles');
      assert.equal(role.current_user, 'harbour_app', `verify-rls must connect as harbour_app (got ${role.current_user})`);
      assert.equal(role.rolsuper, false, 'harbour_app must NOT be a superuser');
      assert.equal(role.rolbypassrls, false, 'harbour_app must NOT have BYPASSRLS');
      console.log(
        `[verify-rls] PASS: connected as ${role.current_user} (rolsuper=${role.rolsuper}, rolbypassrls=${role.rolbypassrls})`
      );
    }

    // 2. Fail-Closed & GUC Bypass Check across all 27 tenant tables
    await db.transaction(async (tx) => {
      if (!isPg) {
        try {
          await tx.exec(`SET LOCAL ROLE harbour_app`);
        } catch {
          // PGlite fallback
        }
      }

      console.log('\nTable                                | No-Ctx | app.platform=on | Wrong-Tenant');
      console.log('-------------------------------------+--------+-----------------+-------------');

      for (const tbl of TENANT_TABLES) {
        await tx.query(`SELECT set_config('app.tenant_id', '', true)`);
        await tx.query(`SELECT set_config('app.platform', '', true)`);
        const noCtxRes = await tx.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM ${tbl}`);
        const noCtxCount = Number(noCtxRes.rows[0]?.cnt ?? -1);
        assert.equal(noCtxCount, 0, `Table ${tbl} leaked ${noCtxCount} rows with no context!`);

        await tx.query(`SELECT set_config('app.platform', 'on', true)`);
        const platRes = await tx.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM ${tbl}`);
        const platCount = Number(platRes.rows[0]?.cnt ?? -1);
        assert.equal(platCount, 0, `Table ${tbl} leaked ${platCount} rows when app.platform='on'!`);

        await tx.query(`SELECT set_config('app.platform', '', true)`);
        await tx.query(`SELECT set_config('app.tenant_id', 'TENANT-FOREIGN-999', true)`);
        const wrongRes = await tx.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM ${tbl}`);
        const wrongCount = Number(wrongRes.rows[0]?.cnt ?? -1);
        assert.equal(wrongCount, 0, `Table ${tbl} leaked ${wrongCount} rows for foreign tenant!`);

        console.log(
          `${tbl.padEnd(36)} | ${String(noCtxCount).padStart(6)} | ${String(platCount).padStart(15)} | ${String(wrongCount).padStart(12)}`
        );
      }
      console.log('');
      console.log('[verify-rls] PASS: 0 rows returned across all 27 tenant tables under No-Ctx, app.platform=on, and Wrong-Tenant');
    });

    // 3. Own-Tenant Access Check
    await db.transaction(async (tx) => {
      if (!isPg) {
        try {
          await tx.exec(`SET LOCAL ROLE harbour_app`);
        } catch {
          // PGlite fallback
        }
      }
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);

      const ownTenant = await tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM core.tenants`);
      assert.equal(ownTenant.rows.length, 1, 'Expected harbour_app to see exactly 1 own tenant row');
      assert.equal(ownTenant.rows[0]?.tenant_id, DEMO_TENANT_ID);

      const ownUsers = await tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM core.users`);
      assert.ok(ownUsers.rows.length > 0, 'Expected to see own tenant users');
      for (const u of ownUsers.rows) {
        assert.equal(u.tenant_id, DEMO_TENANT_ID);
      }
      console.log('[verify-rls] PASS: Cross-tenant isolation and own-tenant visibility verified');
    });

    // 4. Ledger Immutability: UPDATE, DELETE, TRUNCATE on ledger.entries and ledger.journals must be denied
    const testDeniedOp = async (label: string, sql: string) => {
      let denied = false;
      try {
        await db.transaction(async (tx) => {
          if (!isPg) {
            try {
              await tx.exec(`SET LOCAL ROLE harbour_app`);
            } catch {
              // PGlite fallback
            }
          }
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [DEMO_TENANT_ID]);
          await tx.query(sql);
        });
      } catch {
        denied = true;
      }
      assert.equal(denied, true, `${label} must be rejected`);
    };

    await testDeniedOp('UPDATE on ledger.entries', 'UPDATE ledger.entries SET amount_paise = amount_paise + 100');
    await testDeniedOp('DELETE on ledger.entries', 'DELETE FROM ledger.entries');
    await testDeniedOp('TRUNCATE on ledger.entries', 'TRUNCATE TABLE ledger.entries');
    await testDeniedOp('UPDATE on ledger.journals', 'UPDATE ledger.journals SET is_balanced = false');
    await testDeniedOp('DELETE on ledger.journals', 'DELETE FROM ledger.journals');
    await testDeniedOp('TRUNCATE on ledger.journals', 'TRUNCATE TABLE ledger.journals');
    console.log('[verify-rls] PASS: Ledger immutability (UPDATE/DELETE/TRUNCATE denied on entries & journals) verified');

    // 5. Revoked Platform Tables: harbour_app cannot read otp_challenges, refresh_tokens, schema_migrations
    const forbiddenTables = [
      'core.otp_challenges',
      'core.refresh_tokens',
      'core.schema_migrations',
    ];

    for (const tbl of forbiddenTables) {
      let accessDenied = false;
      try {
        await db.transaction(async (tx) => {
          if (!isPg) {
            try {
              await tx.exec(`SET LOCAL ROLE harbour_app`);
            } catch {
              // PGlite fallback
            }
          }
          await tx.query(`SELECT COUNT(*) FROM ${tbl}`);
        });
      } catch {
        accessDenied = true;
      }
      assert.equal(accessDenied, true, `harbour_app must be denied access to ${tbl}`);
    }
    console.log('[verify-rls] PASS: Platform-only tables (otp_challenges, refresh_tokens, schema_migrations) permission denied to harbour_app');

    console.log('[verify-rls] ALL RLS AND LEAST-PRIVILEGE CHECKS PASSED.');
  } finally {
    if (db.close) {
      await db.close();
    }
  }
}

void main();
