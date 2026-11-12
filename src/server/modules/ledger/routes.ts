import { withPlatform } from '@server/ports/db.ts';
import { route } from '@server/platform/http-route.ts';
import {
  AuditImportsQuerySchema,
  ListJournalsQuerySchema,
  ReversalBodySchema,
  VerifyLedgerQuerySchema,
} from './schemas.ts';
import {
  handleLedgerReversalAction,
  listLedgerJournalsKeyset,
  queryAllImportAuditLogsWithLruCache,
} from './service.ts';
import { verifyTenantLedgerChain } from './verify.ts';

export const ledgerRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/ledger/journals',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'List double-entry journals (keyset paginated)',
    tags: ['ledger'],
    query: ListJournalsQuerySchema,
    handler: async (ctx) => {
      const page = await listLedgerJournalsKeyset(ctx.db, {
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

  route({
    method: 'GET',
    path: '/api/v1/ledger/audit-imports',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Fetch LRU-cached audit logs and payout batches',
    tags: ['ledger'],
    query: AuditImportsQuerySchema,
    handler: async (ctx) => {
      const tenantId = ctx.auth!.tenantId;
      const view = String(ctx.query.view ?? 'ALL').toUpperCase();
      const result = await ctx.db.transaction((tx) =>
        queryAllImportAuditLogsWithLruCache(tx, tenantId, view)
      );
      return {
        status: 200,
        headers: { 'X-SQL-LRU-Cache': result.cacheStatus },
        body: {
          tenantId,
          view: result.view,
          cacheStatus: result.cacheStatus,
          cachedAtIso: result.cachedAtIso,
          stats: result.stats,
          auditLogs: result.auditLogs,
          payoutBatches: result.payoutBatches,
        },
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/ledger/reversals',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Request or approve a dual-key compensating journal reversal (§7)',
    tags: ['ledger'],
    body: ReversalBodySchema,
    audit: 'DUAL_KEY_REVERSAL',
    handler: async (ctx) => {
      const out = await handleLedgerReversalAction(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        actorUserId: ctx.auth!.sub,
        actorRole: ctx.auth!.role,
        actorFullName: ctx.auth!.fullName,
        action: ctx.body.action,
        originalJournalId: ctx.body.originalJournalId,
        reasonNote: ctx.body.reasonNote,
        reversalId: ctx.body.reversalId,
      });
      return {
        status: out.status,
        body: out.body,
      };
    },
  }),

  route({
    method: 'GET',
    path: '/api/v1/ledger/verify',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Verify tenant SHA-256 ledger hash chain',
    tags: ['ledger'],
    query: VerifyLedgerQuerySchema,
    handler: async (ctx) => {
      const targetTenant =
        ctx.auth!.role === 'SUPER_ADMIN' && ctx.query.tenantId
          ? String(ctx.query.tenantId)
          : ctx.auth!.tenantId;
      const verification =
        ctx.auth!.role === 'SUPER_ADMIN'
          ? await withPlatform(ctx.platformDb, (tx) =>
              verifyTenantLedgerChain(tx, targetTenant)
            )
          : await verifyTenantLedgerChain(ctx.db, targetTenant);
      return verification;
    },
  }),
];
