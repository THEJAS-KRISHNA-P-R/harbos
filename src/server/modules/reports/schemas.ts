import { z } from 'zod';

export const ReportParamsSchema = z.object({
  reportType: z.enum([
    'daily-auction',
    'fisherman-statement',
    'statutory-apportionment',
    'buyer-ledger',
    'payout-reconciliation',
  ]),
});

export const ReportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  fishermanId: z.string().optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
});

export const ShadowDiffBodySchema = z.object({
  csvText: z.string().min(1),
});
