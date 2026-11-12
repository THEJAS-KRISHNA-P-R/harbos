import { route } from '@server/platform/http-route.ts';
import { OutboxQuerySchema } from './schemas.ts';
import {
  getOutboxDeadLetterTotal,
  listTenantOutboxEvents,
} from './service.ts';

export const notificationsRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/notifications/outbox',
    roles: ['HARBOUR_ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN'],
    summary: 'List transactional SMS outbox events for the caller tenant',
    tags: ['notifications'],
    query: OutboxQuerySchema,
    handler: async (ctx) => {
      const events = await listTenantOutboxEvents(
        ctx.db,
        ctx.auth!.tenantId,
        ctx.query.limit
      );
      return {
        tenantId: ctx.auth!.tenantId,
        deadLetterTotal: getOutboxDeadLetterTotal(),
        events,
      };
    },
  }),
];
