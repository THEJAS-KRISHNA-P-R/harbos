import { z } from 'zod';
import { KeysetQuerySchema } from '@server/platform/pagination.ts';

export const ListJournalsQuerySchema = KeysetQuerySchema;

export const AuditImportsQuerySchema = z.object({
  view: z.string().optional().default('ALL'),
});

export const ReversalBodySchema = z.object({
  action: z.enum(['REQUEST', 'APPROVE']).optional().default('APPROVE'),
  originalJournalId: z.string().optional(),
  reasonNote: z.string().optional(),
  reversalId: z.string().optional(),
});

export const VerifyLedgerQuerySchema = z.object({
  tenantId: z.string().optional(),
});
