import { z } from 'zod';

export const ProvisionTenantBodySchema = z.object({
  slug: z.string().optional(),
  nameEn: z.string().optional(),
  nameMl: z.string().optional(),
  centreType: z.enum(['KERALA_HARBOUR', 'KERALA_MARKET']).optional(),
});

export const ProvisionTenantUserParamsSchema = z.object({
  tenantId: z.string().min(1),
});

export const ProvisionTenantUserBodySchema = z.object({
  phoneE164: z.string().optional(),
  fullName: z.string().optional(),
  role: z.string().optional(),
  entityRefId: z.string().nullable().optional(),
  pinCode: z.string().optional(),
  preferredLocale: z.enum(['ml', 'en']).optional(),
});

export const CreatePolicyBodySchema = z.object({
  commercialMode: z.string().optional(),
  commissionBps: z.number().optional(),
  auctioneerShareBps: z.number().optional(),
  hmsShareBps: z.number().optional(),
  fisherBonusShareBps: z.number().optional(),
  coopShareBps: z.number().optional(),
  notificationRef: z.string().optional(),
  legalSignoffRef: z.string().nullable().optional(),
  legalSignoffDate: z.string().nullable().optional(),
});
