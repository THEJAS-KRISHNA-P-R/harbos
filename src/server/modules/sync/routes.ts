import { route } from '@server/platform/http-route.ts';
import { SyncCommandsBodySchema } from './schemas.ts';
import { processSyncCommands } from './service.ts';

export const syncRoutes = [
  route({
    method: 'POST',
    path: '/api/v1/sync/commands',
    roles: ['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    summary:
      'Apply dockside sync commands (creates WEIGHED_PENDING_INSPECTION lots)',
    tags: ['sync'],
    body: SyncCommandsBodySchema,
    audit: 'LOT_SYNCED_PENDING_INSPECTION',
    handler: async (ctx) =>
      processSyncCommands(
        ctx.db,
        ctx.auth!,
        Array.isArray(ctx.body.commands) ? ctx.body.commands : []
      ),
  }),
];
