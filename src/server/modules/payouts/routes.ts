import { route } from '@server/platform/http-route.ts';
import { invalidateLedgerAuditSqlLruCache } from '@server/modules/ledger/index.ts';
import {
  BuyerReceiptBodySchema,
  BuyerReceiptParamsSchema,
  ReconcileBatchBodySchema,
  ReconcileBatchParamsSchema,
} from './schemas.ts';
import {
  createPayoutBatch,
  executeRobustBulkUtrReconcile,
  handleBankNodalWebhook,
  reconcileSinglePayoutBatch,
  recordBuyerReceipt,
} from './service.ts';

export const payoutsRoutes = [
  route({
    method: 'POST',
    path: '/api/v1/payout-batches',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Generate atomic fisherman net settlement payout batch',
    tags: ['payouts'],
    audit: 'PAYOUT_BATCH_GENERATED',
    handler: async (ctx) => {
      const tenantId = ctx.auth!.tenantId;
      const result = await createPayoutBatch(ctx.db, {
        tenantId,
        actorUserId: ctx.auth!.sub,
        actorRole: ctx.auth!.role,
        actorFullName: ctx.auth!.fullName,
      });
      invalidateLedgerAuditSqlLruCache(tenantId);
      return {
        status: 201,
        body: result,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/payout-batches/:batchId/reconcile',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN'],
    summary: 'Reconcile single payout batch with bank UTR',
    tags: ['payouts'],
    params: ReconcileBatchParamsSchema,
    body: ReconcileBatchBodySchema,
    audit: 'PAYOUT_BATCH_UTR_RECONCILED',
    handler: async (ctx) => {
      const result = await reconcileSinglePayoutBatch(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        actorUserId: ctx.auth!.sub,
        actorRole: ctx.auth!.role,
        actorFullName: ctx.auth!.fullName,
        batchId: ctx.params.batchId,
        rawBankUtr: ctx.body.bankUtr,
        confirmTotalPaise: ctx.body.confirmTotalPaise,
      });
      invalidateLedgerAuditSqlLruCache(ctx.auth!.tenantId);
      return result;
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/payout-batches/bulk-reconcile',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN'],
    summary: 'Bulk reconcile payout batches from bank UTR CSV',
    tags: ['payouts'],
    idempotent: 'optional',
    audit: 'PAYOUT_BATCH_BULK_UTR_RECONCILED',
    handler: async (ctx) => {
      const result = await executeRobustBulkUtrReconcile(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        actorUserId: ctx.auth!.sub,
        actorRole: ctx.auth!.role,
        actorFullName: ctx.auth!.fullName,
        rawBody: ctx.body as Record<string, unknown>,
        headerIdempotencyKey: ctx.idempotencyKey,
      });
      invalidateLedgerAuditSqlLruCache(ctx.auth!.tenantId);
      return result;
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/buyers/:buyerId/receipts',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN'],
    summary: 'Record buyer settlement receipt and post journal',
    tags: ['payouts'],
    params: BuyerReceiptParamsSchema,
    body: BuyerReceiptBodySchema,
    idempotent: 'required',
    audit: 'BUYER_RECEIPT_RECORDED',
    handler: async (ctx) => {
      const referenceNo = (
        ctx.body.referenceNo ??
        ctx.body.paymentReference ??
        'NODAL-RECEIPT'
      ).trim();

      const result = await recordBuyerReceipt(ctx.db, {
        tenantId: ctx.auth!.tenantId,
        actorUserId: ctx.auth!.sub,
        actorRole: ctx.auth!.role,
        actorFullName: ctx.auth!.fullName,
        buyerId: ctx.params.buyerId,
        amountPaise: BigInt(ctx.body.amountPaise),
        paymentChannel: ctx.body.paymentChannel,
        referenceNo,
        idempotencyKey: ctx.idempotencyKey!,
      });
      invalidateLedgerAuditSqlLruCache(ctx.auth!.tenantId);
      return {
        status: result.idempotentReplay ? 200 : 201,
        body: result,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/webhooks/bank-nodal',
    roles: 'PUBLIC',
    summary: 'Automated ISO 20022 / NEFT / RTGS nodal bank webhook callback',
    tags: ['payouts'],
    idempotent: 'optional',
    handler: async (ctx) => {
      const signatureHeader = String(
        ctx.req.headers['x-harbouros-webhook-signature'] ?? ''
      );
      const timestampHeader = String(
        ctx.req.headers['x-harbouros-webhook-timestamp'] ?? ''
      );
      const result = await handleBankNodalWebhook(ctx.db, {
        rawBody: (ctx.body ?? {}) as Record<string, unknown>,
        signatureHeader,
        timestampHeader,
        idempotencyKeyHeader: ctx.idempotencyKey ?? undefined,
      });
      return result;
    },
  }),
];
