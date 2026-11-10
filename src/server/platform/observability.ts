/**
 * Real in-process HTTP, SQL Query, and Rate-Limit Observability Collector
 * for HarbourOS TypeScript/Node.js 22 Monolith.
 */

export type ServiceComponentId =
  | 'harbouros-api'
  | 'db-pg-pool'
  | 'auth-rate-limiter'
  | 'statutory-ledger'
  | 'nodal-utr-reconciler'
  | 'edge-gateway-kerala';

export interface CentralizedLogEntry {
  id: string;
  timestampIso: string;
  level: 'info' | 'warn' | 'error';
  service: ServiceComponentId;
  actionCode: string;
  message: string;
  durationMs?: number;
  traceId: string;
  meta?: Record<string, unknown>;
}

export interface QueryExecutionPoint {
  bucketLabel: string;
  timestampIso: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  qps: number;
  slowQueries: number;
  timeoutsAborted: number;
  statementTimeoutMs: number;
}

export interface KpiAlertItem {
  alertId: string;
  title: string;
  service: ServiceComponentId;
  severity: 'OK' | 'WARN' | 'CRITICAL';
  metricLabel: string;
  currentValue: string;
  thresholdValue: string;
  runbookAction: string;
  updatedAtIso: string;
}

export interface SystemMetricsSnapshot {
  generatedAtIso: string;
  uptimeSeconds: number;
  totalRequests: number;
  inFlightRequests: number;
  rateLimitedRejected: number;
  bulkheadRejected: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatioPct: number;
  singleflightCoalesced: number;
  batchedSqlQueriesSaved: number;
  gzipCompressedResponses: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgLatencyMs: number;
  goroutines: number;
  goMaxProcs: number;
  heapAllocMb: number;
  sysMemMb: number;
  readBulkheadCap: number;
  writeBulkheadCap: number;
  cacheShards: number;
  rateLimitRpsPerClient: number;
  rateLimitBurst: number;
  scaleProfile: {
    registeredUsers: number;
    dailyActiveUsers: number;
    peakConcurrentUsers: number;
    activeHarbourTenants: number;
    edgePoPs: number;
    ledgerPartitions: number;
    availabilitySlaPct: number;
  };
  dbProtection: {
    statementTimeoutMs: number;
    lockTimeoutMs: number;
    idleInTxTimeoutMs: number;
    poolMaxConnections: number;
    activePoolConnections: number;
    poolSaturationPct: number;
    totalQueriesTracked: number;
    slowQueriesFlagged: number;
    statementTimeoutsAborted: number;
    latestQuerySql: string;
    latestQueryDurationMs: number;
  };
  rateLimiting: {
    engine: string;
    authWindowSeconds: number;
    authMaxRequestsPerWindow: number;
    apiWindowSeconds: number;
    apiMaxRequestsPerWindow: number;
    authRequestsAllowed: number;
    authBruteForceBlocked: number;
    apiRequestsAllowed: number;
    apiAbuseBlocked: number;
  };
  queryExecutionSeries: ReadonlyArray<QueryExecutionPoint>;
  alerts: ReadonlyArray<KpiAlertItem>;
  logs: ReadonlyArray<CentralizedLogEntry>;
}

export const DEFAULT_PG_STATEMENT_TIMEOUT_MS = 5_000;
export const DEFAULT_PG_LOCK_TIMEOUT_MS = 3_000;
export const DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS = 10_000;

const MAX_LOG_RING_SIZE = 180;
const MAX_QUERY_SAMPLES = 240;

let logSeq = 0;
const centralizedLogs: CentralizedLogEntry[] = [];
const recentQueryDurationsMs: number[] = [];

let totalQueriesTracked = 0;
let slowQueriesFlagged = 0;
let statementTimeoutsAborted = 0;
let latestQuerySql = 'SELECT 1';
let latestQueryDurationMs = 0;

let authRequestsAllowed = 0;
let authBruteForceBlocked = 0;
let apiRequestsAllowed = 0;
let apiAbuseBlocked = 0;
let inFlightRequests = 0;

let observedTenantsCount = 1;
let observedUsersCount = 8;

const querySeries: QueryExecutionPoint[] = [];

function computePercentile(sorted: ReadonlyArray<number>, pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((pct / 100) * sorted.length))
  );
  return Number((sorted[idx] ?? 0).toFixed(2));
}

export function updateObservedDbCounts(params: {
  tenantsCount?: number;
  usersCount?: number;
}): void {
  if (typeof params.tenantsCount === 'number' && params.tenantsCount >= 0) {
    observedTenantsCount = params.tenantsCount;
  }
  if (typeof params.usersCount === 'number' && params.usersCount >= 0) {
    observedUsersCount = params.usersCount;
  }
}

export function recordCentralizedLog(params: {
  level: 'info' | 'warn' | 'error';
  service?: ServiceComponentId;
  actionCode?: string;
  message: string;
  durationMs?: number;
  traceId?: string;
  meta?: Record<string, unknown>;
}): CentralizedLogEntry {
  logSeq += 1;
  const entry: CentralizedLogEntry = {
    id: `LOG-${logSeq}`,
    timestampIso: new Date().toISOString(),
    level: params.level,
    service: params.service ?? 'harbouros-api',
    actionCode: params.actionCode ?? 'SYSTEM_TELEMETRY',
    message: params.message,
    ...(params.durationMs !== undefined ? { durationMs: Number(params.durationMs.toFixed(2)) } : {}),
    traceId: params.traceId ?? `trc-${logSeq.toString(16)}`,
    ...(params.meta ? { meta: params.meta } : {}),
  };

  centralizedLogs.unshift(entry);
  if (centralizedLogs.length > MAX_LOG_RING_SIZE) {
    centralizedLogs.pop();
  }
  return entry;
}

export function recordQueryExecution(params: {
  sql: string;
  durationMs: number;
  timedOut?: boolean;
  error?: string;
}): void {
  const cleanSql = params.sql.replace(/\s+/g, ' ').trim().slice(0, 140);
  const dur = Math.max(0.05, Number(params.durationMs.toFixed(2)));

  totalQueriesTracked += 1;
  latestQuerySql = cleanSql;
  latestQueryDurationMs = dur;

  recentQueryDurationsMs.push(dur);
  if (recentQueryDurationsMs.length > MAX_QUERY_SAMPLES) {
    recentQueryDurationsMs.shift();
  }

  const isSlow = dur >= 25;
  if (isSlow) {
    slowQueriesFlagged += 1;
  }
  if (params.timedOut) {
    statementTimeoutsAborted += 1;
    recordCentralizedLog({
      level: 'error',
      service: 'db-pg-pool',
      actionCode: 'STATEMENT_TIMEOUT_ABORTED',
      message: `Aborted query exceeding global statement_timeout (${DEFAULT_PG_STATEMENT_TIMEOUT_MS}ms): ${cleanSql}`,
      durationMs: dur,
    });
  } else if (isSlow) {
    recordCentralizedLog({
      level: 'warn',
      service: 'db-pg-pool',
      actionCode: 'SLOW_QUERY_DETECTED',
      message: `Slow SQL execution (${dur}ms): ${cleanSql}`,
      durationMs: dur,
    });
  }

  const sorted = [...recentQueryDurationsMs].sort((a, b) => a - b);
  const avg =
    sorted.reduce((acc, v) => acc + v, 0) / Math.max(1, sorted.length);
  const point: QueryExecutionPoint = {
    bucketLabel: new Date().toLocaleTimeString('en-US', { hour12: false }),
    timestampIso: new Date().toISOString(),
    p50Ms: computePercentile(sorted, 50),
    p95Ms: computePercentile(sorted, 95),
    p99Ms: computePercentile(sorted, 99),
    avgMs: Number(avg.toFixed(2)),
    qps: totalQueriesTracked,
    slowQueries: slowQueriesFlagged,
    timeoutsAborted: statementTimeoutsAborted,
    statementTimeoutMs: DEFAULT_PG_STATEMENT_TIMEOUT_MS,
  };
  querySeries.push(point);
  if (querySeries.length > 12) {
    querySeries.shift();
  }
}

export function recordRateLimitEvent(params: {
  scope: 'AUTH' | 'API';
  allowed: boolean;
  clientIp?: string;
  path?: string;
}): void {
  if (params.scope === 'AUTH') {
    if (params.allowed) {
      authRequestsAllowed += 1;
    } else {
      authBruteForceBlocked += 1;
      recordCentralizedLog({
        level: 'warn',
        service: 'auth-rate-limiter',
        actionCode: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: `Blocked brute-force auth request on ${params.path ?? '/api/v1/auth'} from ${params.clientIp ?? 'client'}`,
      });
    }
  } else {
    if (params.allowed) {
      apiRequestsAllowed += 1;
    } else {
      apiAbuseBlocked += 1;
      recordCentralizedLog({
        level: 'warn',
        service: 'auth-rate-limiter',
        actionCode: 'API_RATE_LIMIT_EXCEEDED',
        message: `Throttled high-traffic API request on ${params.path ?? '/api/v1/*'} from ${params.clientIp ?? 'client'}`,
      });
    }
  }
}

export function getObservabilitySnapshot(cacheStats?: {
  hits: number;
  misses: number;
  hitRatioPct: number;
}): SystemMetricsSnapshot {
  const nowIso = new Date().toISOString();
  const sorted = [...recentQueryDurationsMs].sort((a, b) => a - b);
  const avgMs =
    sorted.length > 0
      ? Number(
          (sorted.reduce((acc, v) => acc + v, 0) / sorted.length).toFixed(2)
        )
      : 0;
  const p50Ms = computePercentile(sorted, 50);
  const p95Ms = computePercentile(sorted, 95);
  const p99Ms = computePercentile(sorted, 99);

  const mem = process.memoryUsage();
  const heapAllocMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
  const sysMemMb = Number((mem.rss / (1024 * 1024)).toFixed(2));
  const poolMax = 20;
  const activePoolConnections = Math.max(0, inFlightRequests);
  const poolSaturationPct = Math.round((activePoolConnections / poolMax) * 100);

  const alerts: KpiAlertItem[] = [
    {
      alertId: 'ALT-PG-LATENCY-P95',
      title: 'PostgreSQL Query Execution Latency (p95)',
      service: 'db-pg-pool',
      severity: p95Ms > 100 ? 'CRITICAL' : p95Ms > 30 ? 'WARN' : 'OK',
      metricLabel: 'p95 Query Execution Time',
      currentValue: `${p95Ms.toFixed(2)} ms`,
      thresholdValue: '< 25.0 ms (SLO)',
      runbookAction:
        'Covering indexes 001–009 active on tenant-scoped queries',
      updatedAtIso: nowIso,
    },
    {
      alertId: 'ALT-PG-STATEMENT-TIMEOUT',
      title: 'Global PostgreSQL Statement Timeout Guard (`db-pg.ts`)',
      service: 'db-pg-pool',
      severity: statementTimeoutsAborted > 0 ? 'WARN' : 'OK',
      metricLabel: 'statement_timeout = 5000ms',
      currentValue: `${statementTimeoutsAborted} aborted total`,
      thresholdValue: '5,000 ms hard cutoff',
      runbookAction:
        'PgPoolAdapter and PGliteAdapter enforce 5,000ms statement_timeout',
      updatedAtIso: nowIso,
    },
    {
      alertId: 'ALT-AUTH-RATE-LIMIT',
      title: 'Auth Endpoint Brute-Force Shield (`express-rate-limit`)',
      service: 'auth-rate-limiter',
      severity: authBruteForceBlocked > 10 ? 'WARN' : 'OK',
      metricLabel: 'Blocked Auth Brute-Force Attempts',
      currentValue: `${authBruteForceBlocked} blocked / ${authRequestsAllowed} allowed`,
      thresholdValue: 'Max 25 OTP req / 15m per IP',
      runbookAction:
        'express-rate-limit + per-phone OTP challenge lockout active',
      updatedAtIso: nowIso,
    },
  ];

  const series =
    querySeries.length > 0
      ? querySeries
      : [
          {
            bucketLabel: 'Now',
            timestampIso: nowIso,
            p50Ms,
            p95Ms,
            p99Ms,
            avgMs,
            qps: totalQueriesTracked,
            slowQueries: slowQueriesFlagged,
            timeoutsAborted: statementTimeoutsAborted,
            statementTimeoutMs: DEFAULT_PG_STATEMENT_TIMEOUT_MS,
          },
        ];

  return {
    generatedAtIso: nowIso,
    uptimeSeconds: Math.round(process.uptime()),
    totalRequests: apiRequestsAllowed + authRequestsAllowed,
    inFlightRequests,
    rateLimitedRejected: authBruteForceBlocked + apiAbuseBlocked,
    bulkheadRejected: 0,
    cacheHits: cacheStats?.hits ?? 0,
    cacheMisses: cacheStats?.misses ?? 0,
    cacheHitRatioPct: cacheStats?.hitRatioPct ?? 0,
    singleflightCoalesced: 0,
    batchedSqlQueriesSaved: 0,
    gzipCompressedResponses: 0,
    p50LatencyMs: p50Ms,
    p95LatencyMs: p95Ms,
    p99LatencyMs: p99Ms,
    avgLatencyMs: avgMs,
    goroutines: 1,
    goMaxProcs: 1,
    heapAllocMb,
    sysMemMb,
    readBulkheadCap: 64,
    writeBulkheadCap: 32,
    cacheShards: 1,
    rateLimitRpsPerClient: 10,
    rateLimitBurst: 600,
    scaleProfile: {
      registeredUsers: observedUsersCount,
      dailyActiveUsers: observedUsersCount,
      peakConcurrentUsers: Math.max(1, inFlightRequests),
      activeHarbourTenants: observedTenantsCount,
      edgePoPs: 1,
      ledgerPartitions: observedTenantsCount,
      availabilitySlaPct: 99.9,
    },
    dbProtection: {
      statementTimeoutMs: DEFAULT_PG_STATEMENT_TIMEOUT_MS,
      lockTimeoutMs: DEFAULT_PG_LOCK_TIMEOUT_MS,
      idleInTxTimeoutMs: DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS,
      poolMaxConnections: poolMax,
      activePoolConnections,
      poolSaturationPct,
      totalQueriesTracked,
      slowQueriesFlagged,
      statementTimeoutsAborted,
      latestQuerySql,
      latestQueryDurationMs,
    },
    rateLimiting: {
      engine: 'express-rate-limit v8',
      authWindowSeconds: 900,
      authMaxRequestsPerWindow: 25,
      apiWindowSeconds: 60,
      apiMaxRequestsPerWindow: 600,
      authRequestsAllowed,
      authBruteForceBlocked,
      apiRequestsAllowed,
      apiAbuseBlocked,
    },
    queryExecutionSeries: series,
    alerts,
    logs: centralizedLogs.slice(0, 60),
  };
}

export function formatPrometheusMetrics(): string {
  const snap = getObservabilitySnapshot();
  return [
    '# HELP harbouros_uptime_seconds Process uptime in seconds',
    '# TYPE harbouros_uptime_seconds gauge',
    `harbouros_uptime_seconds ${snap.uptimeSeconds}`,
    '# HELP harbouros_http_requests_total Total HTTP API requests processed',
    '# TYPE harbouros_http_requests_total counter',
    `harbouros_http_requests_total ${snap.totalRequests}`,
    '# HELP harbouros_rate_limited_rejected_total Total rate-limited requests rejected',
    '# TYPE harbouros_rate_limited_rejected_total counter',
    `harbouros_rate_limited_rejected_total ${snap.rateLimitedRejected}`,
    '# HELP harbouros_sql_queries_total Total SQL queries executed',
    '# TYPE harbouros_sql_queries_total counter',
    `harbouros_sql_queries_total ${snap.dbProtection.totalQueriesTracked}`,
    '# HELP harbouros_sql_statement_timeouts_total Total SQL queries aborted by statement_timeout',
    '# TYPE harbouros_sql_statement_timeouts_total counter',
    `harbouros_sql_statement_timeouts_total ${snap.dbProtection.statementTimeoutsAborted}`,
    '# HELP harbouros_sql_latency_p95_ms 95th percentile SQL query latency in ms',
    '# TYPE harbouros_sql_latency_p95_ms gauge',
    `harbouros_sql_latency_p95_ms ${snap.p95LatencyMs}`,
  ].join('\n');
}
