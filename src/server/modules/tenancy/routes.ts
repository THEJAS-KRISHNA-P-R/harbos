import { route } from '@server/platform/http-route.ts';
import { ALL_ROLES } from '@shared/contracts/rbac.ts';
import {
  CreatePolicyBodySchema,
  ProvisionTenantBodySchema,
  ProvisionTenantUserBodySchema,
  ProvisionTenantUserParamsSchema,
} from './schemas.ts';
import {
  createCommissionPolicy,
  getWorkspaceBootstrap,
  provisionHonestTenant,
  provisionTenantUser,
} from './service.ts';

export const tenancyRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/bootstrap',
    roles: ALL_ROLES,
    summary: 'Fetch role-scoped workspace bootstrap state (bounded to 50 rows)',
    tags: ['tenancy'],
    handler: async (ctx) => {
      const payload = await getWorkspaceBootstrap(ctx.db, ctx.auth!);
      return {
        status: 200,
        headers: { 'X-SQL-LRU-Cache': payload.cacheStatus },
        body: payload.body,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/tenants',
    roles: ['SUPER_ADMIN'],
    summary:
      'Provision new harbour tenant with policy v1, ledger head, and 5 institutional accounts',
    tags: ['tenancy'],
    body: ProvisionTenantBodySchema,
    audit: 'TENANT_PROVISIONED',
    handler: async (ctx) => {
      const created = await provisionHonestTenant(ctx.platformDb, ctx.body);
      return {
        status: 201,
        body: created,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/tenants/:tenantId/users',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
    summary: 'Provision operator user for a harbour tenant',
    tags: ['tenancy'],
    params: ProvisionTenantUserParamsSchema,
    body: ProvisionTenantUserBodySchema,
    audit: 'TENANT_USER_PROVISIONED',
    handler: async (ctx) => {
      const created = await provisionTenantUser(
        ctx.platformDb,
        ctx.db,
        ctx.auth!,
        ctx.params.tenantId,
        ctx.body
      );
      return {
        status: 201,
        body: created,
      };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/policies',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
    summary: 'Create versioned commission policy (enforces C7 legal sign-off gate)',
    tags: ['tenancy'],
    body: CreatePolicyBodySchema,
    audit: 'COMMISSION_POLICY_CREATED',
    handler: async (ctx) => {
      const created = await createCommissionPolicy(
        ctx.db,
        ctx.auth!.tenantId,
        ctx.body
      );
      return {
        status: 201,
        body: created,
      };
    },
  }),
];
