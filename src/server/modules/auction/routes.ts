import { route } from '@server/platform/http-route.ts';
import { ALL_ROLES } from '@shared/contracts/rbac.ts';
import type { AuctionMode } from '@shared/ids.ts';
import {
  AllocateLotParamsSchema,
  AllocateSaleBodySchema,
  ListAllocationsQuerySchema,
} from './schemas.ts';
import {
  executeLotAllocation,
  listAllocationsKeyset,
} from './service.ts';

export const auctionRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/allocations',
    roles: ALL_ROLES,
    summary: 'List statutory sale allocations (keyset paginated)',
    tags: ['auction'],
    query: ListAllocationsQuerySchema,
    handler: async (ctx) => {
      const page = await listAllocationsKeyset(ctx.db, {
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
    method: 'POST',
    path: '/api/v1/lots/:lotId/allocate',
    roles: ['LICENSED_AUCTIONEER', 'HARBOUR_ADMIN'],
    summary:
      'Execute atomic statutory lot sale allocation and 5% split journal (§7)',
    tags: ['auction'],
    params: AllocateLotParamsSchema,
    body: AllocateSaleBodySchema,
    idempotent: 'required',
    audit: 'LOT_SALE_ALLOCATED',
    handler: async (ctx) => {
      const out = await executeLotAllocation(
        ctx.db,
        ctx.auth!,
        ctx.params.lotId,
        ctx.idempotencyKey!,
        {
          ...ctx.body,
          auctionMode: ctx.body.auctionMode as AuctionMode,
        }
      );
      return {
        status: out.status,
        body: out.body,
      };
    },
  }),
];
