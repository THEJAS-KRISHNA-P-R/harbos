import { route } from '@server/platform/http-route.ts';
import { ALL_ROLES } from '@shared/contracts/rbac.ts';
import type { InspectionGrade } from '@shared/ids.ts';
import {
  AiAssistBodySchema,
  CreateLotBodySchema,
  InspectLotBodySchema,
  ListLotsQuerySchema,
  LotIdParamsSchema,
  ReprintLotSlipBodySchema,
} from './schemas.ts';
import {
  createAndTagLot,
  inspectLotQuality,
  listLotsKeyset,
  recordLotSlipReprint,
} from './service.ts';

export interface CatchAssistFn {
  (params: {
    speciesNameEn: string;
    coreTempC: number;
    inspectorNotes: string;
  }): Promise<{
    available: boolean;
    suggestedSpeciesCode?: string;
    suggestedGrade?: 'A_EXPORT' | 'A_DOMESTIC' | 'B_PROCESS';
    confidenceNote?: string;
    advisoryDisclaimer: string;
  }>;
}

export function createLotsRoutes(runCatchAssist?: CatchAssistFn) {
  return [
    route({
      method: 'GET',
      path: '/api/v1/lots',
      roles: ALL_ROLES,
      summary: 'List weighed and auction lots (keyset paginated)',
      tags: ['lots'],
      query: ListLotsQuerySchema,
      handler: async (ctx) => {
        const page = await listLotsKeyset(ctx.db, {
          tenantId: ctx.auth!.tenantId,
          cursor: ctx.query.cursor,
          limit: ctx.query.limit,
          status: ctx.query.status,
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
      path: '/api/v1/lots',
      roles: ['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
      summary:
        'Create and tag weighed lot (creates WEIGHED_PENDING_INSPECTION)',
      tags: ['lots'],
      body: CreateLotBodySchema,
      audit: 'LOT_WEIGHED_AND_TAGGED',
      handler: async (ctx) => {
        const created = await createAndTagLot(ctx.db, ctx.auth!, ctx.body);
        return {
          status: 201,
          body: created,
        };
      },
    }),

    route({
      method: 'POST',
      path: '/api/v1/lots/:lotId/inspect',
      roles: ['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN'],
      summary:
        'Perform Section 21 organoleptic & core temperature quality inspection',
      tags: ['lots'],
      params: LotIdParamsSchema,
      body: InspectLotBodySchema,
      audit: 'QUALITY_INSPECTION_S21',
      handler: async (ctx) => {
        const grade = (ctx.body.grade ??
          ctx.body.inspectionGrade)! as InspectionGrade;
        return inspectLotQuality(ctx.db, ctx.auth!, ctx.params.lotId, {
          grade,
          coreTempC: ctx.body.coreTempC,
          notes: ctx.body.notes,
          overrideReason: ctx.body.overrideReason,
        });
      },
    }),

    route({
      method: 'POST',
      path: '/api/v1/lots/:lotId/ai-assist',
      roles: ['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
      summary:
        'Optional advisory catch quality AI assist (ADR-009: never auto-grades)',
      tags: ['lots'],
      params: LotIdParamsSchema,
      body: AiAssistBodySchema,
      handler: async (ctx) => {
        const speciesNameEn = String(ctx.body.speciesNameEn ?? 'Marine Catch');
        const coreTempC = Number(ctx.body.coreTempC ?? 2.0);
        const inspectorNotes = String(ctx.body.inspectorNotes ?? '');
        if (!runCatchAssist) {
          return {
            available: false,
            advisoryDisclaimer:
              'AI suggestion — inspector must confirm (ADR-009). Status: UNAVAILABLE.',
          };
        }
        return runCatchAssist({
          speciesNameEn,
          coreTempC,
          inspectorNotes,
        });
      },
    }),

    route({
      method: 'POST',
      path: '/api/v1/lots/:lotId/reprint',
      roles: [
        'WEIGHING_OPERATOR',
        'LICENSED_AUCTIONEER',
        'ACCOUNTANT',
        'HARBOUR_ADMIN',
        'SUPER_ADMIN',
      ],
      summary:
        'Audit and authorize dockside slip reprint with REPRINT watermark',
      tags: ['lots'],
      params: LotIdParamsSchema,
      body: ReprintLotSlipBodySchema,
      audit: 'LOT_SLIP_REPRINTED',
      handler: async (ctx) =>
        recordLotSlipReprint(ctx.db, ctx.auth!, ctx.params.lotId, ctx.body),
    }),
  ];
}
