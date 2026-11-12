import { z } from 'zod';

export const ReconcileBatchParamsSchema = z.object({
  batchId: z.string().min(1),
});

export const ReconcileBatchBodySchema = z.object({
  bankUtr: z.unknown(),
  confirmTotalPaise: z.unknown().optional(),
});

export const BuyerReceiptParamsSchema = z.object({
  buyerId: z.string().min(1),
});

export const BuyerReceiptBodySchema = z.object({
  amountPaise: z.union([
    z.number().int().positive(),
    z.string().regex(/^[1-9]\d*$/),
  ]),
  paymentChannel: z
    .enum(['UPI_ESCROW', 'NEFT', 'RTGS', 'IMPS', 'NODAL_TRANSFER'])
    .optional()
    .default('NEFT'),
  referenceNo: z.string().min(2).max(120).optional(),
  paymentReference: z.string().min(2).max(120).optional(),
});
