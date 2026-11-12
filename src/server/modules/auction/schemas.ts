import { z } from 'zod';
import { KeysetQuerySchema } from '@server/platform/pagination.ts';

export const ListAllocationsQuerySchema = KeysetQuerySchema;

export const AllocateLotParamsSchema = z.object({
  lotId: z.string().min(1),
});

export const AllocateSaleBodySchema = z
  .object({
    sessionId: z.string().min(1),
    auctionMode: z.enum([
      'PHYSICAL_SHOUT',
      'DUTCH_IDEAL',
      'HYBRID_REMOTE',
      'COOP_PROCUREMENT',
      'HMS_DIRECT_TAKEOVER',
    ]),
    auctioneerLicenceId: z.string().min(1),
    buyerId: z.string().min(1),
    boxesAllocated: z.number().int().positive().optional(),
    boxesRequested: z.number().int().positive().optional(),
    pricePerKgPaise: z.union([
      z.number().int().positive(),
      z.string().regex(/^[1-9]\d*$/),
    ]),
    fencingToken: z.number().int().nonnegative(),
    governmentPermissionRef: z.string().optional(),
    idempotencyKey: z.string().optional(),
  })
  .refine(
    (data) =>
      (typeof data.boxesAllocated === 'number' && data.boxesAllocated > 0) ||
      (typeof data.boxesRequested === 'number' && data.boxesRequested > 0),
    {
      message: 'boxesAllocated (or boxesRequested) must be a positive integer',
      path: ['boxesAllocated'],
    }
  );
