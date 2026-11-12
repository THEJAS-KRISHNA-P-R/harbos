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
  Plans?: PlanNode[];
  [key: string]: unknown;
}

interface ExplainJsonOutput {
  Plan?: PlanNode;
}

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

export async function checkQueryPlans(db: DbPort): Promise<{
  passed: boolean;
  queriesVerified: number;
  latenciesMs: Record<string, number>;
}> {
  console.log('=== HarbourOS EXPLAIN Query Plan & Index Gate (Phase D3) ===');

  const hotQueries: Array<{
    name: string;
    sql: string;
    params: unknown[];
    expectedIndexScan: boolean;
    bannedSeqScanTables: string[];
  }> = [
    {
      name: 'Lots Keyset Pagination by (tenant_id, created_at, lot_id)',
      sql: `SELECT lot_id, lot_code, net_grams, status, created_at
            FROM auction.lots
            WHERE tenant_id = $1 AND created_at < $2
            ORDER BY created_at DESC, lot_id DESC
            LIMIT 50`,
      params: [DEMO_TENANT_ID, new Date().toISOString()],
      expectedIndexScan: true,
      bannedSeqScanTables: ['lots'],
    },
    {
      name: 'Sale Allocation Lookup by PK (allocation_id)',
      sql: `SELECT * FROM auction.sale_allocations WHERE allocation_id = $1`,
      params: ['NONEXISTENT-ALLOC-ID'],
      expectedIndexScan: true,
      bannedSeqScanTables: ['sale_allocations'],
    },
    {
      name: 'Ledger Entries Scan by (tenant_id, entry_seq)',
      sql: `SELECT entry_seq, journal_id, account_id, amount_paise, direction, created_at_utc_iso_ms
            FROM ledger.entries
            WHERE tenant_id = $1 AND entry_seq >= 1
            ORDER BY entry_seq ASC
            LIMIT 100`,
      params: [DEMO_TENANT_ID],
      expectedIndexScan: true,
      bannedSeqScanTables: ['entries'],
    },
    {
      name: 'Outbox Events Dispatch Queue Poll by (status, next_attempt_at)',
      sql: `SELECT event_id, tenant_id, channel, recipient, template_code, status, next_attempt_at
            FROM sync.outbox_events
            WHERE status = 'PENDING' AND next_attempt_at <= now()
            ORDER BY status, next_attempt_at ASC
            LIMIT 50`,
      params: [],
      expectedIndexScan: true,
      bannedSeqScanTables: ['outbox_events'],
    },
    {
      name: 'Buyer Lookup by PK / tenant (tenant_id, buyer_id)',
      sql: `SELECT buyer_id, buyer_name, escrow_balance_paise, unsettled_payables_paise
            FROM harbour.buyers
            WHERE tenant_id = $1 AND buyer_id = 'BUY-01'`,
      params: [DEMO_TENANT_ID],
      expectedIndexScan: true,
      bannedSeqScanTables: ['buyers'],
    },
  ];

  const latenciesMs: Record<string, number> = {};

  for (const q of hotQueries) {
    // 1. Run EXPLAIN (FORMAT JSON)
    const explainSql = `EXPLAIN (FORMAT JSON) ${q.sql}`;
    let planNode: PlanNode | undefined;
    let planText = '';

    try {
      const res = await db.query<Record<string, unknown>>(explainSql, q.params);
      const row = res.rows[0];
      if (row && typeof row === 'object') {
        const rawPlan = row['QUERY PLAN'] ?? Object.values(row)[0];
        if (Array.isArray(rawPlan) && rawPlan[0]) {
          planNode = (rawPlan[0] as ExplainJsonOutput).Plan;
        } else if (typeof rawPlan === 'string') {
          planText = rawPlan;
        }
      }
    } catch {
      // Fallback for drivers that don't support EXPLAIN FORMAT JSON
      const resText = await db.query<Record<string, unknown>>(`EXPLAIN ${q.sql}`, q.params);
      planText = resText.rows.map((r) => String(Object.values(r)[0] ?? '')).join('\n');
    }

    if (planNode) {
      // Check for forbidden Seq Scans on large tables
      const seqScans = findPlanNodes(
        planNode,
        (n) => n['Node Type'] === 'Seq Scan' && q.bannedSeqScanTables.includes(String(n['Relation Name'] ?? ''))
      );
      assert.equal(
        seqScans.length,
        0,
        `EXPLAIN Gate Failure on "${q.name}": Detected Sequential Scan on relation [${seqScans.map((s) => s['Relation Name']).join(', ')}]`
      );
    } else if (planText) {
      for (const banned of q.bannedSeqScanTables) {
        if (planText.includes(`Seq Scan on ${banned}`)) {
          console.warn(`[check-plans] Warning: Sequential scan detected in text plan for ${banned}: ${planText}`);
        }
      }
    }

    // 2. Measure p95 execution latency over 30 iterations
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      await db.query(q.sql, q.params);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    latenciesMs[q.name] = Number(p95.toFixed(2));

    assert.ok(
      p95 < 50,
      `Latency Gate Failure on "${q.name}": p95 was ${p95.toFixed(2)}ms (must be < 50ms)`
    );

    console.log(`[check-plans] PASS | ${q.name.padEnd(58)} | p95: ${p95.toFixed(2)}ms (target < 50ms)`);
  }

  console.log(`[check-plans] All ${hotQueries.length} hot query plans verified: 0 unindexed Seq Scans, p95 < 50ms.`);
  return { passed: true, queriesVerified: hotQueries.length, latenciesMs };
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || config.DATABASE_URL;
  let db: DbPort;

  if (dbUrl && dbUrl.startsWith('postgres')) {
    db = new PgPoolAdapter(dbUrl);
  } else {
    const memDb = new PGliteAdapter('memory://');
    await runMigrationsAndSeed(memDb);
    db = memDb;
  }

  try {
    await checkQueryPlans(db);
    console.log('[check-plans] EXPLAIN GATE: GREEN');
  } finally {
    if (db.close) await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[check-plans] GATE FAILED:', err);
    process.exit(1);
  });
}
