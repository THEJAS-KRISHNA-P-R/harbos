import { route } from '@server/platform/http-route.ts';
import {
  formatPrometheusMetrics,
  getObservabilitySnapshot,
} from '@server/platform/observability.ts';
import { ledgerAuditSqlLruCache } from '@server/modules/ledger/index.ts';
import { ListAuditLogsQuerySchema } from './schemas.ts';
import {
  getGovernanceMigrations,
  getHarbourBenchmarks,
  getReadinessStatus,
  listAuditLogsKeyset,
} from './service.ts';

export const platformRoutes = [
  route({
    method: 'GET',
    path: '/healthz',
    roles: 'PUBLIC',
    summary: 'Liveness probe (zero DB work)',
    tags: ['platform'],
    handler: async () => ({ status: 'ok' }),
  }),

  route({
    method: 'GET',
    path: '/readyz',
    roles: 'PUBLIC',
    summary: 'Readiness probe (DB ping + migration version)',
    tags: ['platform'],
    handler: async (ctx) => getReadinessStatus(ctx.platformDb),
  }),

  route({
    method: 'GET',
    path: '/api/health',
    roles: 'PUBLIC',
    summary: 'API health & readiness summary',
    tags: ['platform'],
    handler: async (ctx) => getReadinessStatus(ctx.platformDb),
  }),

  route({
    method: 'GET',
    path: '/api/v1/metrics',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
    summary: 'Process and SQL metrics (Prometheus or JSON)',
    tags: ['platform'],
    handler: async (ctx) => {
      const accept = String(ctx.req.headers.accept ?? '');
      if (accept.includes('text/plain')) {
        ctx.res
          .status(200)
          .type('text/plain; version=0.0.4; charset=utf-8')
          .send(formatPrometheusMetrics());
        return { status: 200, body: {} };
      }
      return getObservabilitySnapshot(ledgerAuditSqlLruCache.stats());
    },
  }),

  route({
    method: 'GET',
    path: '/api/v1/governance/migrations',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
    summary: 'Schema governance migrations and journal balance audit',
    tags: ['platform'],
    handler: async (ctx) =>
      getGovernanceMigrations(
        ctx.platformDb,
        ctx.db,
        ctx.auth!.role === 'SUPER_ADMIN'
      ),
  }),

  route({
    method: 'GET',
    path: '/api/v1/benchmarks/harbours',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN', 'ACCOUNTANT'],
    summary: 'Cross-harbour benchmarks and SDK metadata',
    tags: ['platform'],
    handler: async (ctx) =>
      getHarbourBenchmarks(
        ctx.platformDb,
        ctx.db,
        ctx.auth!.tenantId,
        ctx.auth!.role === 'SUPER_ADMIN'
      ),
  }),

  route({
    method: 'GET',
    path: '/api/v1/audit-logs',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'List immutable audit logs (keyset paginated)',
    tags: ['platform'],
    query: ListAuditLogsQuerySchema,
    handler: async (ctx) => {
      const page = await listAuditLogsKeyset(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        cursor: ctx.query.cursor,
        limit: ctx.query.limit,
      });
      return {
        status: 200,
        body: page,
        enableEtag: true,
      };
    },
  }),
];
