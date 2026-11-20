import assert from 'node:assert/strict';
import { config } from '../src/server/config.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { runMigrationsAndSeed, DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import type { DbPort } from '../src/server/ports/db.ts';

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Total Time'?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

interface ExplainJsonOutput {
  Plan?: PlanNode;
  'Execution Time'?: number;
}

const INDEX_NODE_TYPES = new Set([
  'Index Scan',
  'Index Only Scan',
  'Bitmap Index Scan',
  'Bitmap Heap Scan',
]);

function findPlanNodes(node: PlanNode | undefined, predicate: (n: PlanNode) => boolean): PlanNode[] {
  if (!node) return [];
  const results: PlanNode[] = [];
  if (predicate(node)) results.push(node);
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      results.push(...findPlanNodes(child, predicate));
    }
  }
  return results;
}

interface HotQuerySpec {
  readonly name: string;
  readonly sql: string;
  readonly params: unknown[];
  readonly usePlatformDb?: boolean;
  readonly primaryTable: string;
}

export async function checkQueryPlans(
  appDb: DbPort,
  platformDb: DbPort = appDb,
  options?: { requireLargeFixture?: boolean }
): Promise<{
  passed: boolean;
  queriesVerified: number;
  tableRowCounts: Record<string, number>;
  latenciesMs: Record<string, number>;
}> {
  const requireLargeFixture = options?.requireLargeFixture ?? !appDb.isPglite;

  console.log('=== HarbourOS EXPLAIN (ANALYZE) Query Plan & Scale Gate ===');

  // 1. Measure & print exact row counts across all core/harbour/auction/ledger/sync tables
  const monitoredTables = [
    'core.tenants',
    'core.audit_logs',
    'harbour.fishermen',
    'harbour.buyers',
    'auction.lots',
    'auction.sale_allocations',
    'ledger.accounts',
    'ledger.journals',
    'ledger.entries',
    'ledger.payout_batches',
    'ledger.payout_batch_items',
    'ledger.buyer_receipts',
    'sync.outbox_events',
  ];

  const tableRowCounts: Record<string, number> = {};
  const largeTables = new Set<string>();

  console.log('\nTable                        | Row Count');
  console.log('-----------------------------+-----------');
  for (const fq of monitoredTables) {
    const res = await platformDb.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM ${fq}`);
    const cnt = Number(res.rows[0]?.cnt ?? 0);
    tableRowCounts[fq] = cnt;
    const relName = fq.split('.')[1]!;
    if (cnt > 100_000) {
      largeTables.add(relName);
    }
    console.log(`${fq.padEnd(28)} | ${String(cnt).padStart(9)}`);
  }
  console.log('');

  const ledgerEntryCount = tableRowCounts['ledger.entries'] ?? 0;
  if (requireLargeFixture && ledgerEntryCount <= 100_000) {
    throw new Error(
      `Scale fixture precondition failed: ledger.entries has ${ledgerEntryCount} rows (expected > 100,000). Run \`npx tsx scripts/scale-fixture.ts\` first.`
    );
  }

  // 2. Pick a populated scaled tenant (prefer scale-harbour-01, else demo tenant)
  const scaleTenantRes = await platformDb.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM core.tenants WHERE tenant_id = 'scale-harbour-01' LIMIT 1`
  );
  const targetTenantId = scaleTenantRes.rows[0]?.tenant_id ?? DEMO_TENANT_ID;

  const [sampleLotRes, sampleBuyerRes, sampleFisherRes] = await Promise.all([
    platformDb.query<{ lot_id: string }>(
      `SELECT lot_id FROM auction.lots WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [targetTenantId]
    ),
    platformDb.query<{ buyer_id: string }>(
      `SELECT buyer_id FROM harbour.buyers WHERE tenant_id = $1 ORDER BY paddle_no ASC LIMIT 1`,
      [targetTenantId]
    ),
    platformDb.query<{ fisherman_id: string }>(
      `SELECT fisherman_id FROM harbour.fishermen WHERE tenant_id = $1 ORDER BY fisherman_id ASC LIMIT 1`,
      [targetTenantId]
    ),
  ]);

  const sampleLotId = sampleLotRes.rows[0]?.lot_id ?? 'LOT-MISSING';
  const sampleBuyerId = sampleBuyerRes.rows[0]?.buyer_id ?? 'BUY-MISSING';
  const sampleFisherId = sampleFisherRes.rows[0]?.fisherman_id ?? 'FSH-MISSING';
  const nowIso = new Date().toISOString();
  const dayAgoIso = new Date(Date.now() - 86_400_000).toISOString();

  console.log(
    `[check-plans] Target tenant: ${targetTenantId} | lot=${sampleLotId} | buyer=${sampleBuyerId} | fisher=${sampleFisherId}`
  );

  // 3. Define 13 hot queries covering every operational path & statutory report
  const hotQueries: ReadonlyArray<HotQuerySpec> = [
    {
      name: '1. Lots by status (tenant_id, status, lot_code)',
      sql: `SELECT lot_id, lot_code, net_grams, status, created_at
            FROM auction.lots
            WHERE tenant_id = $1 AND status = 'OPEN_FOR_AUCTION'
            ORDER BY lot_code ASC
            LIMIT 50`,
      params: [targetTenantId],
      primaryTable: 'lots',
    },
    {
      name: '2. Lots keyset pagination newest-first',
      sql: `SELECT lot_id, lot_code, net_grams, status, created_at
            FROM auction.lots
            WHERE tenant_id = $1 AND created_at < $2
            ORDER BY created_at DESC, lot_id DESC
            LIMIT 50`,
      params: [targetTenantId, nowIso],
      primaryTable: 'lots',
    },
    {
      name: '3. Allocations by lot (tenant_id, lot_id, seq)',
      sql: `SELECT allocation_id, allocation_seq, buyer_id, boxes_allocated, hammer_paise
            FROM auction.sale_allocations
            WHERE tenant_id = $1 AND lot_id = $2
            ORDER BY allocation_seq ASC`,
      params: [targetTenantId, sampleLotId],
      primaryTable: 'sale_allocations',
    },
    {
      name: '4. Ledger entries by (tenant_id, entry_seq) [>100k table]',
      sql: `SELECT entry_seq, journal_id, account_id, direction, amount_paise, prev_row_hash, row_hash
            FROM ledger.entries
            WHERE tenant_id = $1 AND entry_seq > 100
            ORDER BY entry_seq ASC
            LIMIT 500`,
      params: [targetTenantId],
      primaryTable: 'entries',
    },
    {
      name: '5. Journals newest-first (keyset index)',
      sql: `SELECT journal_id, reference_type, reference_id, total_amount_paise, created_at
            FROM ledger.journals
            WHERE tenant_id = $1
            ORDER BY created_at DESC, journal_id DESC
            LIMIT 50`,
      params: [targetTenantId],
      primaryTable: 'journals',
    },
    {
      name: '6. Audit logs newest-first (keyset index)',
      sql: `SELECT audit_id, actor_user_id, actor_role, action_code, target_type, target_id, created_at
            FROM core.audit_logs
            WHERE tenant_id = $1
            ORDER BY created_at DESC, audit_id DESC
            LIMIT 50`,
      params: [targetTenantId],
      primaryTable: 'audit_logs',
    },
    {
      name: '7. Fisherman payables (tenant_id, kind, balance > 0)',
      sql: `SELECT account_id, owner_entity_id, balance_paise
            FROM ledger.accounts
            WHERE tenant_id = $1 AND kind = 'FISHERMAN_PAYABLE' AND balance_paise > 0
            ORDER BY account_id ASC`,
      params: [targetTenantId],
      primaryTable: 'accounts',
    },
    {
      name: '8. Buyer lookup by (tenant_id, buyer_id)',
      sql: `SELECT buyer_id, buyer_name, paddle_no, escrow_balance_paise, unsettled_payables_paise
            FROM harbour.buyers
            WHERE tenant_id = $1 AND buyer_id = $2`,
      params: [targetTenantId, sampleBuyerId],
      primaryTable: 'buyers',
    },
    {
      name: '9. Outbox poll (status=PENDING, next_attempt_at <= now())',
      sql: `SELECT event_id, tenant_id, channel, recipient, template_code, status, next_attempt_at
            FROM sync.outbox_events
            WHERE status = 'PENDING' AND next_attempt_at <= now()
            ORDER BY next_attempt_at ASC, created_at ASC
            LIMIT 50`,
      params: [],
      usePlatformDb: true,
      primaryTable: 'outbox_events',
    },
    {
      name: '10. Report: Daily auction (lots in 24h window)',
      sql: `SELECT lot_id, lot_code, status, total_boxes, net_grams, created_at
            FROM auction.lots
            WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
            ORDER BY created_at DESC`,
      params: [targetTenantId, dayAgoIso, nowIso],
      primaryTable: 'lots',
    },
    {
      name: '11. Report: Fisherman statement (payout items by fisherman)',
      sql: `SELECT pbi.item_id, pbi.fisherman_id, pbi.amount_paise, pb.status
            FROM ledger.payout_batch_items pbi
            JOIN ledger.payout_batches pb ON pb.batch_id = pbi.batch_id AND pb.tenant_id = pbi.tenant_id
            WHERE pbi.tenant_id = $1 AND pbi.fisherman_id = $2`,
      params: [targetTenantId, sampleFisherId],
      primaryTable: 'payout_batch_items',
    },
    {
      name: '12. Report: Buyer ledger (allocations + receipts by buyer)',
      sql: `SELECT allocation_id, buyer_id, buyer_payable_paise, created_at
            FROM auction.sale_allocations
            WHERE tenant_id = $1 AND buyer_id = $2`,
      params: [targetTenantId, sampleBuyerId],
      primaryTable: 'sale_allocations',
    },
    {
      name: '13. Report: Payout reconciliation (batches newest-first)',
      sql: `SELECT batch_id, batch_code, beneficiary_kind, total_amount_paise, item_count, status, bank_utr, created_at
            FROM ledger.payout_batches
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT 50`,
      params: [targetTenantId],
      primaryTable: 'payout_batches',
    },
  ];

  const latenciesMs: Record<string, number> = {};

  for (const q of hotQueries) {
    const runnerDb = q.usePlatformDb ? platformDb : appDb;
    const explainSql = `EXPLAIN (ANALYZE, FORMAT JSON) ${q.sql}`;

    let planNode: PlanNode | undefined;
    await runnerDb.transaction(async (tx) => {
      if (!q.usePlatformDb) {
        await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [targetTenantId]);
      }
      const res = await tx.query<Record<string, unknown>>(explainSql, q.params);
      const row = res.rows[0];
      if (row && typeof row === 'object') {
        const rawPlan = row['QUERY PLAN'] ?? Object.values(row)[0];
        if (Array.isArray(rawPlan) && rawPlan[0]) {
          planNode = (rawPlan[0] as ExplainJsonOutput).Plan;
        }
      }
    });

    assert.ok(planNode, `EXPLAIN (ANALYZE, FORMAT JSON) did not return a JSON plan for "${q.name}"`);

    const indexNodes = findPlanNodes(planNode, (n) => INDEX_NODE_TYPES.has(String(n['Node Type'] ?? '')));
    const seqScanNodes = findPlanNodes(planNode, (n) => n['Node Type'] === 'Seq Scan');

    // Assert NO Seq Scan on any table with > 100k rows
    const largeSeqScans = seqScanNodes.filter((n) => largeTables.has(String(n['Relation Name'] ?? '')));
    assert.equal(
      largeSeqScans.length,
      0,
      `EXPLAIN Gate Failure on "${q.name}": Seq Scan on >100k-row table(s) [${largeSeqScans.map((s) => s['Relation Name']).join(', ')}]`
    );

    // Assert NO Seq Scan on the query's primary target table
    const primarySeqScans = seqScanNodes.filter((n) => String(n['Relation Name'] ?? '') === q.primaryTable);
    assert.equal(
      primarySeqScans.length,
      0,
      `EXPLAIN Gate Failure on "${q.name}": Seq Scan on primary table "${q.primaryTable}"`
    );

    // Assert at least one index scan is used
    assert.ok(
      indexNodes.length > 0,
      `EXPLAIN Gate Failure on "${q.name}": Expected index usage (Index Scan / Index Only Scan / Bitmap Index Scan), got root="${planNode['Node Type']}"`
    );

    // Measure p95 latency across 25 real executions
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      await runnerDb.transaction(async (tx) => {
        if (!q.usePlatformDb) {
          await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [targetTenantId]);
        }
        await tx.query(q.sql, q.params);
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0;
    latenciesMs[q.name] = Number(p95.toFixed(2));

    assert.ok(
      p95 < 50,
      `Latency Gate Failure on "${q.name}": p95 was ${p95.toFixed(2)}ms (must be < 50ms)`
    );

    const idxSummary = indexNodes
      .map((n) => `${n['Node Type']}(${n['Index Name'] ?? n['Relation Name'] ?? '?'})`)
      .slice(0, 2)
      .join(' + ');

    console.log(
      `[check-plans] PASS | ${q.name.padEnd(58)} | p95: ${p95.toFixed(2).padStart(5)}ms | ${idxSummary}`
    );
  }

  console.log(
    `\n[check-plans] All ${hotQueries.length} hot queries verified: index scans enforced, 0 Seq Scans on >100k tables, p95 < 50ms.`
  );
  return {
    passed: true,
    queriesVerified: hotQueries.length,
    tableRowCounts,
    latenciesMs,
  };
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL || config.DATABASE_URL;
  const platformUrl = process.env.DATABASE_PLATFORM_URL || config.DATABASE_PLATFORM_URL || appUrl;
  let appDb: DbPort;
  let platformDb: DbPort;

  if (appUrl && appUrl.startsWith('postgres')) {
    appDb = new PgPoolAdapter(appUrl);
    platformDb =
      platformUrl && platformUrl.startsWith('postgres') && platformUrl !== appUrl
        ? new PgPoolAdapter(platformUrl)
        : appDb;
  } else {
    const memDb = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(memDb);
    appDb = memDb;
    platformDb = memDb;
  }

  try {
    const requireLargeFixture = process.env.REQUIRE_SCALE_ROWS !== 'false' && !appDb.isPglite;
    await checkQueryPlans(appDb, platformDb, { requireLargeFixture });
    console.log('[check-plans] EXPLAIN GATE: GREEN');
  } finally {
    if (appDb.close) await appDb.close();
    if (platformDb !== appDb && platformDb.close) await platformDb.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[check-plans] GATE FAILED:', err);
    process.exit(1);
  });
}
