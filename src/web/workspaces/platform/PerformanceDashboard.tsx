import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Activity,
  Database,
  FileDown,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Users,
} from 'lucide-react';
import { Badge, Button, Card } from '@web/ui/index.tsx';
import {
  apiRequest,
  downloadTextFile,
  formatCentralizedLogsCsv,
  formatObservabilityBundleJson,
} from '@web/lib/api.ts';

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

export interface SystemObservabilityMetrics {
  generatedAtIso?: string;
  uptimeSeconds?: number;
  totalRequests?: number;
  inFlightRequests?: number;
  rateLimitedRejected?: number;
  cacheHits?: number;
  cacheMisses?: number;
  cacheHitRatioPct?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  p99LatencyMs?: number;
  avgLatencyMs?: number;
  scaleProfile?: {
    registeredUsers: number;
    dailyActiveUsers: number;
    peakConcurrentUsers: number;
    activeHarbourTenants: number;
    edgePoPs: number;
    ledgerPartitions: number;
    availabilitySlaPct: number;
  };
  dbProtection?: {
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
  rateLimiting?: {
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
  queryExecutionSeries?: ReadonlyArray<QueryExecutionPoint>;
  alerts?: ReadonlyArray<KpiAlertItem>;
  logs?: ReadonlyArray<CentralizedLogEntry>;
}

const SERVICE_FILTER_OPTIONS: ReadonlyArray<{ id: 'ALL' | ServiceComponentId; label: string }> = [
  { id: 'ALL', label: 'All Services' },
  { id: 'harbouros-api', label: 'harbouros-api' },
  { id: 'db-pg-pool', label: 'db-pg-pool' },
  { id: 'auth-rate-limiter', label: 'auth-rate-limiter' },
  { id: 'statutory-ledger', label: 'statutory-ledger' },
  { id: 'nodal-utr-reconciler', label: 'nodal-utr-reconciler' },
  { id: 'edge-gateway-kerala', label: 'edge-gateway-kerala' },
];

export const PerformanceDashboard: React.FC<{
  token: string;
  onMetricsRefreshed?: (snapshot: SystemObservabilityMetrics) => void;
}> = ({ token, onMetricsRefreshed }) => {
  const [metrics, setMetrics] = useState<SystemObservabilityMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedService, setSelectedService] = useState<'ALL' | ServiceComponentId>('ALL');
  const [logSearchQuery, setLogSearchQuery] = useState('');

  const onMetricsRefreshedRef = React.useRef(onMetricsRefreshed);
  onMetricsRefreshedRef.current = onMetricsRefreshed;

  const fetchSystemMetrics = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await apiRequest<SystemObservabilityMetrics>('/api/v1/metrics', {
        method: 'GET',
        token,
      });
      setMetrics(res);
      onMetricsRefreshedRef.current?.(res);
    } catch {
      // Keep last known snapshot on transient poll errors
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchSystemMetrics();
  }, [fetchSystemMetrics]);

  const chartSeries = useMemo<QueryExecutionPoint[]>(() => {
    if (metrics?.queryExecutionSeries && metrics.queryExecutionSeries.length > 0) {
      return [...metrics.queryExecutionSeries];
    }
    return [
      {
        bucketLabel: 'Now',
        timestampIso: new Date().toISOString(),
        p50Ms: 1.5,
        p95Ms: 4.2,
        p99Ms: 7.8,
        avgMs: 2.0,
        qps: 12,
        slowQueries: 0,
        timeoutsAborted: 0,
        statementTimeoutMs: 5000,
      },
    ];
  }, [metrics]);

  const filteredLogs = useMemo<CentralizedLogEntry[]>(() => {
    const rawLogs = metrics?.logs ?? [];
    const normQuery = logSearchQuery.trim().toLowerCase();
    return rawLogs.filter((entry) => {
      if (selectedService !== 'ALL' && entry.service !== selectedService) {
        return false;
      }
      if (!normQuery) {
        return true;
      }
      return (
        entry.actionCode.toLowerCase().includes(normQuery) ||
        entry.message.toLowerCase().includes(normQuery) ||
        entry.service.toLowerCase().includes(normQuery) ||
        entry.traceId.toLowerCase().includes(normQuery)
      );
    });
  }, [metrics?.logs, selectedService, logSearchQuery]);

  const scale = metrics?.scaleProfile ?? {
    registeredUsers: 11,
    dailyActiveUsers: 11,
    peakConcurrentUsers: 1,
    activeHarbourTenants: 4,
    edgePoPs: 1,
    ledgerPartitions: 4,
    availabilitySlaPct: 99.9,
  };

  const dbProt = metrics?.dbProtection ?? {
    statementTimeoutMs: 5000,
    lockTimeoutMs: 3000,
    idleInTxTimeoutMs: 10000,
    poolMaxConnections: 20,
    activePoolConnections: 1,
    poolSaturationPct: 5,
    totalQueriesTracked: 24,
    slowQueriesFlagged: 0,
    statementTimeoutsAborted: 0,
    latestQuerySql: 'SELECT * FROM core.audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 25',
    latestQueryDurationMs: 1.5,
  };

  const rateLimit = metrics?.rateLimiting ?? {
    engine: 'express-rate-limit v8',
    authWindowSeconds: 900,
    authMaxRequestsPerWindow: 25,
    apiWindowSeconds: 60,
    apiMaxRequestsPerWindow: 600,
    authRequestsAllowed: 1,
    authBruteForceBlocked: 0,
    apiRequestsAllowed: 12,
    apiAbuseBlocked: 0,
  };

  const alerts = metrics?.alerts ?? [];
  const latestPoint = chartSeries[chartSeries.length - 1];

  const handleExportTelemetryJson = (): void => {
    const payload = formatObservabilityBundleJson({
      scaleProfile: scale,
      dbProtection: dbProt,
      rateLimiting: rateLimit,
      queryExecutionSeries: chartSeries,
      alerts,
      logs: filteredLogs,
    });
    downloadTextFile(
      'harbouros-observability-bundle.json',
      payload,
      'application/json;charset=utf-8;'
    );
  };

  const handleExportLogsCsv = (): void => {
    const csv = formatCentralizedLogsCsv(filteredLogs);
    downloadTextFile('harbouros-centralized-logs.csv', csv);
  };

  return (
    <Card
      title="Observability & Performance Dashboard"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok" label={`${scale.activeHarbourTenants} TENANTS`} />
          <Badge tone="info" label={`STATEMENT TIMEOUT ${dbProt.statementTimeoutMs}MS`} />
          <Button
            variant="outline"
            size="sm"
            data-testid="export-telemetry-json-btn"
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExportTelemetryJson}
          >
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="export-logs-csv-btn"
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExportLogsCsv}
          >
            Export Logs CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void fetchSystemMetrics()}
          >
            Refresh Metrics
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5" data-testid="performance-dashboard-widget">
        {/* 1. Observed Tenant Footprint, DB Statement Timeout & Rate-Limit Protection Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <Users className="w-3.5 h-3.5 text-[var(--brand)]" />
                <span>Provisioned Footprint</span>
              </div>
              <Badge tone="ok" label={`${scale.availabilitySlaPct}% TARGET`} />
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)]">
              {scale.registeredUsers.toLocaleString()} Active Operators
            </div>
            <div className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-hair)]">
              <span>Tenants: {scale.activeHarbourTenants}</span>
              <span>In-Flight: {scale.peakConcurrentUsers}</span>
              <span>RLS Chains: {scale.ledgerPartitions}</span>
            </div>
          </div>

          <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <Database className="w-3.5 h-3.5 text-[var(--info)]" />
                <span>Statement Timeout Guard</span>
              </div>
              <Badge
                tone={dbProt.statementTimeoutsAborted > 0 ? 'warn' : 'ok'}
                label={`CUTOFF ${dbProt.statementTimeoutMs}MS`}
              />
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)]">
              {dbProt.totalQueriesTracked.toLocaleString()} Queries Tracked
            </div>
            <div className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-hair)]">
              <span>Slow: {dbProt.slowQueriesFlagged}</span>
              <span>Aborted: {dbProt.statementTimeoutsAborted}</span>
              <span>Pool: {dbProt.poolSaturationPct}%</span>
            </div>
          </div>

          <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--brand)]" />
                <span>Edge Rate Limiting</span>
              </div>
              <Badge
                tone={rateLimit.authBruteForceBlocked > 10 ? 'warn' : 'ok'}
                label="EXPRESS-RATE-LIMIT"
              />
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)]">
              {rateLimit.authBruteForceBlocked.toLocaleString()} Brute-Force Blocked
            </div>
            <div className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-hair)]">
              <span>OTP Cap: {rateLimit.authMaxRequestsPerWindow}/15m</span>
              <span>Floods Blocked: {rateLimit.apiAbuseBlocked}</span>
            </div>
          </div>
        </div>

        {/* 2. Recharts LineChart Visualizing Query Execution Times from /api/v1/metrics */}
        <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-strong)] flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--brand)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Observed SQL Query Execution Latency (ms)
              </h3>
            </div>
            {latestPoint && (
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono-code">
                <Badge tone="ok" label={`p50: ${latestPoint.p50Ms} ms`} />
                <Badge tone="info" label={`p95: ${latestPoint.p95Ms} ms`} />
                <Badge
                  tone={latestPoint.p99Ms > 25 ? 'warn' : 'ok'}
                  label={`p99: ${latestPoint.p99Ms} ms`}
                />
                <Badge tone="neutral" label={`${latestPoint.qps.toLocaleString()} Queries`} />
              </div>
            )}
          </div>

          <div className="w-full h-64" data-testid="query-execution-line-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartSeries}
                margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hair)" />
                <XAxis
                  dataKey="bucketLabel"
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  unit=" ms"
                  stroke="var(--text-secondary)"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-strong)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="p99Ms"
                  name="p99 Query Latency (ms)"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="p95Ms"
                  name="p95 Query Latency (ms)"
                  stroke="var(--amber-500)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="avgMs"
                  name="Avg Query Time (ms)"
                  stroke="var(--info)"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="p50Ms"
                  name="p50 Median Query Time (ms)"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. KPI Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {alerts.map((alert) => (
            <div
              key={alert.alertId}
              className="p-3 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                  {alert.title}
                </div>
                <div className="text-[11px] font-mono-code text-[var(--text-secondary)]">
                  {alert.metricLabel}: <strong className="text-[var(--text-primary)]">{alert.currentValue}</strong> (SLO: {alert.thresholdValue})
                </div>
              </div>
              <Badge
                tone={
                  alert.severity === 'CRITICAL'
                    ? 'danger'
                    : alert.severity === 'WARN'
                      ? 'warn'
                      : 'ok'
                }
                label={alert.severity}
              />
            </div>
          ))}
        </div>

        {/* 4. Centralized Multi-Service Log Stream */}
        <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[var(--brand)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Centralized Log Stream
              </h3>
            </div>

            <div className="w-full lg:w-72 relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)]"
                placeholder="Search logs by actionCode, service, traceId..."
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                aria-label="Filter centralized logs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SERVICE_FILTER_OPTIONS.map((opt) => (
              <Button
                key={opt.id}
                variant={selectedService === opt.id ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSelectedService(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] overflow-x-auto max-h-64">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hair)] bg-[var(--bg-sunken)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Level</th>
                  <th className="py-2 px-3">Service</th>
                  <th className="py-2 px-3">Action Code</th>
                  <th className="py-2 px-3">Message</th>
                  <th className="py-2 px-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hair)] font-mono-code">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">
                      No centralized log entries match the current service or search filter.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.slice(0, 20).map((log) => (
                    <tr key={log.id} className="hover:bg-[var(--bg-tint)]">
                      <td className="py-2 px-3 whitespace-nowrap text-[var(--text-muted)]">
                        {log.timestampIso.slice(11, 23)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <Badge
                          tone={
                            log.level === 'error'
                              ? 'danger'
                              : log.level === 'warn'
                                ? 'warn'
                                : 'ok'
                          }
                          label={log.level.toUpperCase()}
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-[var(--brand)] font-semibold">
                        {log.service}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-bold text-[var(--text-primary)]">
                        {log.actionCode}
                      </td>
                      <td className="py-2 px-3 text-[var(--text-secondary)] min-w-[280px]">
                        {log.message}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right text-[var(--text-primary)]">
                        {log.durationMs !== undefined ? `${log.durationMs} ms` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
};
