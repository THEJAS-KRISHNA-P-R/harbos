import { route } from '@server/platform/http-route.ts';
import {
  ReportParamsSchema,
  ReportQuerySchema,
  ShadowDiffBodySchema,
} from './schemas.ts';
import {
  computeShadowPilotDiff,
  formatRowsAsCsv,
  generateHarbourReport,
} from './service.ts';

export const reportsRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/reports/:reportType',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Generate statutory Section 22 & financial reports (JSON or RFC 4180 formula-safe CSV)',
    tags: ['reports'],
    params: ReportParamsSchema,
    query: ReportQuerySchema,
    useReadReplica: true,
    handler: async (ctx) => {
      const report = await generateHarbourReport(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        reportType: ctx.params.reportType,
        from: ctx.query.from,
        to: ctx.query.to,
        fishermanId: ctx.query.fishermanId,
      });

      if (ctx.query.format === 'csv') {
        const csvContent = formatRowsAsCsv(report.headers, report.rows);
        ctx.res
          .status(200)
          .type('text/csv; charset=utf-8')
          .setHeader(
            'Content-Disposition',
            `attachment; filename="harbouros-${ctx.params.reportType}.csv"`
          )
          .send(csvContent);
        return { status: 200, body: {} };
      }

      return report;
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/reports/shadow-diff',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Compare paper-register daily totals CSV against HarbourOS sale allocations (0-paise divergence check)',
    tags: ['reports'],
    body: ShadowDiffBodySchema,
    useReadReplica: true,
    handler: async (ctx) =>
      computeShadowPilotDiff(ctx.db, ctx.auth!.tenantId, ctx.body.csvText),
  }),
];
