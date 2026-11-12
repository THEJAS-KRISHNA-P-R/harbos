import { route } from '@server/platform/http-route.ts';
import type { AuctionMode } from '@shared/ids.ts';
import {
  BuyerBodySchema,
  CoopSocietyBodySchema,
  DeactivateMasterdataParamsSchema,
  FishermanBodySchema,
  FloorPricesBodySchema,
  ImportCsvBodySchema,
  ImportMasterdataParamsSchema,
  LicenceBodySchema,
  MasterdataEntityParamsSchema,
  SessionBodySchema,
  SpeciesBodySchema,
  VesselBodySchema,
} from './schemas.ts';
import {
  createOrUpdateBuyer,
  createOrUpdateCoopSociety,
  createOrUpdateFisherman,
  createOrUpdateLicence,
  createOrUpdateSession,
  createOrUpdateSpecies,
  createOrUpdateVessel,
  deactivateMasterdataEntity,
  importMasterdataCsv,
  listMasterdataEntities,
  updateSection19FloorSchedule,
} from './service.ts';

export const masterdataRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/masterdata/:entityType',
    roles: ['HARBOUR_ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN'],
    summary: 'List masterdata entities for the caller tenant',
    tags: ['masterdata'],
    params: MasterdataEntityParamsSchema,
    handler: async (ctx) => {
      const items = await listMasterdataEntities(
        ctx.db,
        ctx.auth!.tenantId,
        ctx.params.entityType
      );
      return {
        entityType: ctx.params.entityType,
        items,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/coop-societies',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Create or update co-operative society',
    tags: ['masterdata'],
    body: CoopSocietyBodySchema,
    audit: 'MASTERDATA_SOCIETY_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateCoopSociety(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/fishermen',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Create or update fisherman and auto-provision payable & bonus escrow accounts',
    tags: ['masterdata'],
    body: FishermanBodySchema,
    audit: 'MASTERDATA_FISHERMAN_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateFisherman(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/vessels',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Create or update vessel and generate signed dockside QR token',
    tags: ['masterdata'],
    body: VesselBodySchema,
    audit: 'MASTERDATA_VESSEL_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateVessel(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/buyers',
    roles: ['HARBOUR_ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN'],
    summary:
      'Create or update wholesale buyer (validates GSTIN mod-36 checksum & provisions receivable account)',
    tags: ['masterdata'],
    body: BuyerBodySchema,
    audit: 'MASTERDATA_BUYER_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateBuyer(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/licences',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Create or update auctioneer licence (enforces s.5 1-year validity & provisions payable account)',
    tags: ['masterdata'],
    body: LicenceBodySchema,
    audit: 'MASTERDATA_LICENCE_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateLicence(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/species',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Create or update species and append floor price change to harbour.floor_price_history',
    tags: ['masterdata'],
    body: SpeciesBodySchema,
    audit: 'MASTERDATA_SPECIES_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateSpecies(ctx.db, ctx.auth!, ctx.body),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/sessions',
    roles: ['HARBOUR_ADMIN', 'LICENSED_AUCTIONEER', 'SUPER_ADMIN'],
    summary: 'Create or update auction session',
    tags: ['masterdata'],
    body: SessionBodySchema,
    audit: 'MASTERDATA_SESSION_UPSERTED',
    handler: async (ctx) => ({
      status: 201,
      body: await createOrUpdateSession(ctx.db, ctx.auth!, {
        ...ctx.body,
        auctionMode: ctx.body.auctionMode as AuctionMode,
      }),
    }),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/:entityType/:id/deactivate',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Soft-deactivate masterdata entity (is_active = false)',
    tags: ['masterdata'],
    params: DeactivateMasterdataParamsSchema,
    audit: 'MASTERDATA_DEACTIVATED',
    handler: async (ctx) =>
      deactivateMasterdataEntity(
        ctx.db,
        ctx.auth!,
        ctx.params.entityType,
        ctx.params.id
      ),
  }),

  route({
    method: 'POST',
    path: '/api/v1/masterdata/import/:entityType',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Bulk CSV import for masterdata with dryRun validation and formula-injection guard',
    tags: ['masterdata'],
    params: ImportMasterdataParamsSchema,
    body: ImportCsvBodySchema,
    audit: 'MASTERDATA_CSV_IMPORT',
    handler: async (ctx) =>
      importMasterdataCsv(
        ctx.db,
        ctx.auth!,
        ctx.params.entityType,
        ctx.body.csvText,
        ctx.body.dryRun
      ),
  }),

  route({
    method: 'POST',
    path: '/api/v1/floor-prices',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary: 'Update Section 19 floor price and enforcement mode',
    tags: ['masterdata'],
    body: FloorPricesBodySchema,
    audit: 'FLOOR_SCHEDULE_UPDATED_S19',
    handler: async (ctx) =>
      updateSection19FloorSchedule(ctx.db, ctx.auth!, ctx.body),
  }),
];
