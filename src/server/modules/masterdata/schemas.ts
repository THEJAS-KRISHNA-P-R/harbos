import { z } from 'zod';

export const MasterdataEntityParamsSchema = z.object({
  entityType: z.enum([
    'coop-societies',
    'fishermen',
    'vessels',
    'buyers',
    'licences',
    'species',
    'sessions',
  ]),
});

export const DeactivateMasterdataParamsSchema = z.object({
  entityType: z.enum([
    'coop-societies',
    'fishermen',
    'vessels',
    'buyers',
    'licences',
    'species',
    'sessions',
  ]),
  id: z.string().min(1),
});

export const ImportMasterdataParamsSchema = z.object({
  entityType: z.enum([
    'coop-societies',
    'fishermen',
    'vessels',
    'buyers',
    'species',
    'licences',
  ]),
});

export const CoopSocietyBodySchema = z.object({
  societyId: z.string().optional(),
  regNo: z.string().min(2).max(80),
  nameEn: z.string().min(2).max(160),
  nameMl: z.string().optional(),
});

export const FishermanBodySchema = z.object({
  fishermanId: z.string().optional(),
  fullName: z.string().min(2).max(160),
  phoneE164: z.string().regex(/^\+[1-9]\d{9,14}$/, 'Invalid E.164 phone number'),
  welfareBoardNo: z.string().min(2).max(80),
  coopSocietyId: z.string().nullable().optional(),
  nfdpId: z.string().nullable().optional(),
  bankAccountRef: z.string().nullable().optional(),
});

export const VesselBodySchema = z.object({
  vesselId: z.string().optional(),
  registrationNo: z.string().min(3).max(80),
  vesselNameEn: z.string().min(2).max(160),
  vesselNameMl: z.string().optional(),
  ownerFishermanId: z.string().min(1),
  hasActiveSocietyLoan: z.boolean().optional().default(false),
  loanCoopSocietyId: z.string().nullable().optional(),
});

export const BuyerBodySchema = z.object({
  buyerId: z.string().optional(),
  buyerName: z.string().min(2).max(160),
  paddleNo: z.number().int().positive(),
  gstin: z.string().nullable().optional(),
  exportRegNo: z.string().nullable().optional(),
  escrowBalancePaise: z
    .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
    .optional()
    .default(0),
  approvedCreditPaise: z
    .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
    .optional()
    .default(0),
  bankGuaranteeRef: z.string().nullable().optional(),
  bankGuaranteePaise: z
    .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
    .optional()
    .default(0),
});

export const LicenceBodySchema = z.object({
  licenceId: z.string().optional(),
  auctioneerUserId: z.string().min(1),
  auctioneerName: z.string().min(2).max(160),
  licenceNo: z.string().min(2).max(80),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED']).optional().default('ACTIVE'),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deputedBySocietyId: z.string().nullable().optional(),
});

export const SpeciesBodySchema = z.object({
  speciesId: z.string().optional(),
  code: z.string().min(2).max(32),
  nameEn: z.string().min(2).max(160),
  nameMl: z.string().optional(),
  scientificName: z.string().optional().default('Marine Teleost'),
  floorPricePaisePerKg: z.union([
    z.number().int().positive(),
    z.string().regex(/^[1-9]\d*$/),
  ]),
  exportEligible: z.boolean().optional().default(true),
});

export const SessionBodySchema = z.object({
  sessionId: z.string().optional(),
  sessionCode: z.string().min(2).max(80),
  auctionMode: z
    .enum([
      'PHYSICAL_SHOUT',
      'DUTCH_IDEAL',
      'HYBRID_REMOTE',
      'COOP_PROCUREMENT',
      'HMS_DIRECT_TAKEOVER',
    ])
    .optional()
    .default('PHYSICAL_SHOUT'),
  leaderDeviceId: z.string().optional().default('PIT-PAD-01'),
  fencingToken: z.number().int().positive().optional().default(1),
  dutchStartPricePaise: z
    .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)])
    .optional()
    .default(75000),
  dutchFloorPricePaise: z
    .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)])
    .optional()
    .default(60000),
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional().default('OPEN'),
});

export const ImportCsvBodySchema = z.object({
  csvText: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
});

export const FloorPricesBodySchema = z.object({
  floorEnforcement: z.enum(['BLOCK', 'WARN']).optional(),
  speciesId: z.string().optional(),
  floorPricePaisePerKg: z
    .union([z.number().int(), z.string()])
    .optional(),
});
