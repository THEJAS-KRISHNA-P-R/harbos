import { z } from 'zod';
import { KeysetQuerySchema } from '@server/platform/pagination.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';

export const ListLotsQuerySchema = KeysetQuerySchema.extend({
  status: z.string().optional(),
});

export const CreateLotBodySchema = z.object({
  vesselId: z.string().optional(),
  speciesId: z.string().optional(),
  totalBoxes: z.number().optional(),
  netGrams: z.union([z.number(), z.string()]).optional(),
  coreTempC: z.number().optional(),
  weightSource: z.string().optional(),
  supervisorPin: z.string().optional(),
});

export const LotIdParamsSchema = z.object({
  lotId: z.string().min(1),
});

export const InspectLotBodySchema = z
  .object({
    grade: z
      .enum(['A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT'])
      .optional(),
    inspectionGrade: z
      .enum(['A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT'])
      .optional(),
    coreTempC: z.number().finite().min(-30).max(50).optional().default(2.0),
    notes: z
      .string()
      .max(500)
      .optional()
      .default(`Inspected under ${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE}`),
    overrideReason: z.string().max(500).optional(),
  })
  .refine((d) => Boolean(d.grade || d.inspectionGrade), {
    message: 'grade (or inspectionGrade) is required',
    path: ['grade'],
  });

export const AiAssistBodySchema = z.object({
  speciesNameEn: z.string().optional(),
  coreTempC: z.number().optional(),
  inspectorNotes: z.string().optional(),
});

export const ReprintLotSlipBodySchema = z.object({
  slipType: z
    .enum(['LOT_LABEL', 'BUYER_SALE_SLIP', 'FISHERMAN_SETTLEMENT_SLIP'])
    .optional()
    .default('LOT_LABEL'),
  paperSize: z.enum(['58mm', '80mm', 'A4']).optional().default('80mm'),
  reason: z.string().max(250).optional().default('Dockside thermal slip reprint'),
});
