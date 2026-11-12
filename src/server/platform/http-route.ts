import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ROUTE_RBAC_MATRIX,
  type Role,
} from '@shared/contracts/rbac.ts';
import {
  createDbRequestStats,
  runWithLazyTenantDb,
  withRetry,
  type DbPort,
  type DbRequestStats,
} from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { logger } from '@server/platform/logger.ts';
import {
  verifyAccessJwt,
  resolveUserActiveStatusForAuth,
  type AuthSessionClaims,
  type AuthenticatedRequest,
} from '@server/platform/auth.ts';
import { computeListEtag } from '@server/platform/pagination.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContext<
  TParams = Record<string, string>,
  TQuery = Record<string, unknown>,
  TBody = unknown,
> {
  readonly req: AuthenticatedRequest;
  readonly res: Response;
  readonly auth: AuthSessionClaims | undefined;
  readonly db: DbPort;
  readonly platformDb: DbPort;
  readonly readDb: DbPort;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly requestId: string;
  readonly idempotencyKey: string | null;
  readonly dbStats: DbRequestStats;
}

export interface RouteResult<T = unknown> {
  readonly status?: number;
  readonly body: T;
  readonly headers?: Record<string, string>;
  readonly enableEtag?: boolean;
}

export interface RouteDeclaration<
  TParams = Record<string, string>,
  TQuery = Record<string, unknown>,
  TBody = unknown,
  TResponse = unknown,
> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly roles: ReadonlyArray<Role> | 'PUBLIC';
  readonly summary?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly params?: z.ZodType<TParams>;
  readonly query?: z.ZodType<TQuery>;
  readonly body?: z.ZodType<TBody>;
  readonly response?: z.ZodType<TResponse>;
  readonly idempotent?: 'required' | 'optional';
  readonly audit?: string;
  readonly useReadReplica?: boolean;
  readonly handler: (
    ctx: RouteContext<TParams, TQuery, TBody>
  ) => Promise<RouteResult<TResponse> | TResponse>;
}

const registeredRoutes: Array<RouteDeclaration<any, any, any, any>> = [];

export function route<
  TParams = Record<string, string>,
  TQuery = Record<string, unknown>,
  TBody = unknown,
  TResponse = unknown,
>(
  decl: RouteDeclaration<TParams, TQuery, TBody, TResponse>
): RouteDeclaration<TParams, TQuery, TBody, TResponse> {
  return decl;
}

export function getRegisteredRoutes(): ReadonlyArray<
  RouteDeclaration<any, any, any, any>
> {
  return registeredRoutes;
}

export function resetRegisteredRoutes(): void {
  registeredRoutes.length = 0;
}

function verifyAgainstRbacMatrix(
  decl: RouteDeclaration<any, any, any, any>
): void {
  const entry = ROUTE_RBAC_MATRIX.find(
    (r) => r.method === decl.method && r.pattern === decl.path
  );
  if (!entry) {
    throw new Error(
      `FATAL [rbac]: Route "${decl.method} ${decl.path}" is missing from ROUTE_RBAC_MATRIX in src/shared/contracts/rbac.ts (default deny).`
    );
  }
  if (entry.roles === 'PUBLIC' || decl.roles === 'PUBLIC') {
    if (entry.roles !== decl.roles) {
      throw new Error(
        `FATAL [rbac]: Route "${decl.method} ${decl.path}" PUBLIC role mismatch with ROUTE_RBAC_MATRIX.`
      );
    }
    return;
  }
  const matrixSet = new Set(entry.roles);
  const declSet = new Set(decl.roles);
  if (
    matrixSet.size !== declSet.size ||
    [...matrixSet].some((r) => !declSet.has(r))
  ) {
    throw new Error(
      `FATAL [rbac]: Route "${decl.method} ${decl.path}" roles [${decl.roles.join(', ')}] do not match ROUTE_RBAC_MATRIX [${entry.roles.join(', ')}].`
    );
  }
}

function parseZodWith400<T>(
  schema: z.ZodType<T> | undefined,
  raw: unknown,
  sourceLabel: string
): T {
  if (!schema) {
    return (raw ?? {}) as T;
  }
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map((iss) => ({
      field: iss.path.join('.') || sourceLabel,
      message: iss.message,
    }));
    throw new AppError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? `Invalid ${sourceLabel}`,
      400,
      { fieldErrors }
    );
  }
  return parsed.data;
}

function isRouteResult(val: unknown): val is RouteResult<unknown> {
  return (
    Boolean(val) &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    'body' in (val as Record<string, unknown>) &&
    ('status' in (val as Record<string, unknown>) ||
      'headers' in (val as Record<string, unknown>) ||
      'enableEtag' in (val as Record<string, unknown>))
  );
}

export function mountDeclarativeRoutes(
  app: Express,
  routes: ReadonlyArray<RouteDeclaration<any, any, any, any>>,
  deps: {
    db: DbPort;
    platformDb: DbPort;
    readDb?: DbPort;
  }
): void {
  const effectiveReadDb = deps.readDb ?? deps.db;

  for (const decl of routes) {
    verifyAgainstRbacMatrix(decl);
    if (
      !registeredRoutes.some(
        (r) => r.method === decl.method && r.path === decl.path
      )
    ) {
      registeredRoutes.push(decl);
    }

    const methodLower = decl.method.toLowerCase() as
      | 'get'
      | 'post'
      | 'put'
      | 'patch'
      | 'delete';

    app[methodLower](
      decl.path,
      async (req: Request, res: Response, next: NextFunction) => {
        const authReq = req as AuthenticatedRequest;
        const requestId =
          String(res.getHeader('X-Request-Id') || '') || 'req-unknown';
        const dbStats = createDbRequestStats();

        try {
          // 1. Authenticate & Authorize via RBAC table
          let claims: AuthSessionClaims | undefined;
          if (decl.roles !== 'PUBLIC') {
            const header = req.headers.authorization;
            if (!header || !header.startsWith('Bearer ')) {
              throw new AppError(
                'UNAUTHORIZED',
                'Missing Bearer access token',
                401
              );
            }
            const token = header.slice('Bearer '.length).trim();
            claims = await verifyAccessJwt(token);

            const userStatus = await resolveUserActiveStatusForAuth(
              deps.db,
              claims.tenantId,
              claims.sub
            );
            if (userStatus.exists) {
              if (!userStatus.isActive) {
                throw new AppError(
                  'UNAUTHORIZED',
                  'Operator account is deactivated',
                  401
                );
              }
              if (userStatus.tenantId === claims.tenantId) {
                claims = {
                  ...claims,
                  role: userStatus.role,
                };
              }
            }

            if (!decl.roles.includes(claims.role)) {
              throw new AppError(
                'FORBIDDEN',
                `Role ${claims.role} is not permitted for this endpoint. Required: ${decl.roles.join(', ')}`,
                403
              );
            }
            authReq.auth = claims;
          }

          // 2. Parse params, query, body with Zod (400 with fieldErrors)
          const params = parseZodWith400(decl.params, req.params, 'params');
          const query = parseZodWith400(decl.query, req.query, 'query');
          const body =
            decl.method === 'GET'
              ? ((req.body ?? {}) as unknown)
              : parseZodWith400(decl.body, req.body, 'body');

          // 3. Check Idempotency-Key header / body field
          const rawIdemHeader = req.headers['idempotency-key'];
          const headerIdem = Array.isArray(rawIdemHeader)
            ? rawIdemHeader[0]
            : rawIdemHeader;
          const bodyIdem =
            body &&
            typeof body === 'object' &&
            'idempotencyKey' in (body as Record<string, unknown>) &&
            typeof (body as Record<string, unknown>).idempotencyKey === 'string'
              ? String((body as Record<string, unknown>).idempotencyKey)
              : undefined;
          const idempotencyKey =
            (headerIdem ?? bodyIdem ?? '').trim() || null;

          if (decl.idempotent === 'required' && !idempotencyKey) {
            throw new AppError(
              'VALIDATION_ERROR',
              `Idempotency-Key header (or idempotencyKey field) is required for ${decl.method} ${decl.path}.`,
              400,
              {
                fieldErrors: [
                  {
                    field: 'Idempotency-Key',
                    message: 'Idempotency-Key header is required',
                  },
                ],
              }
            );
          }

          // 4. Execute handler with lazy per-request transaction (GET -> READ ONLY REPEATABLE READ; Write -> READ COMMITTED + withRetry)
          const isReadOnly = decl.method === 'GET';
          const targetBaseDb =
            isReadOnly && decl.useReadReplica ? effectiveReadDb : deps.db;

          const executeHandler = async (): Promise<unknown> => {
            if (claims?.tenantId) {
              return runWithLazyTenantDb(
                targetBaseDb,
                claims.tenantId,
                { readOnly: isReadOnly, stats: dbStats },
                async (lazyDb) => {
                  authReq.db = lazyDb;
                  return decl.handler({
                    req: authReq,
                    res,
                    auth: claims,
                    db: lazyDb,
                    platformDb: deps.platformDb,
                    readDb: effectiveReadDb,
                    params,
                    query,
                    body,
                    requestId,
                    idempotencyKey,
                    dbStats,
                  });
                }
              );
            }

            return decl.handler({
              req: authReq,
              res,
              auth: claims,
              db: targetBaseDb,
              platformDb: deps.platformDb,
              readDb: effectiveReadDb,
              params,
              query,
              body,
              requestId,
              idempotencyKey,
              dbStats,
            });
          };

          const rawResult = isReadOnly
            ? await executeHandler()
            : await withRetry(() => executeHandler());

          if (res.headersSent) {
            return;
          }

          res.setHeader('X-DB-Queries', String(dbStats.queries));
          res.setHeader('X-DB-RoundTrips', String(dbStats.roundTrips));
          res.setHeader('X-DB-Ms', dbStats.dbMs.toFixed(2));

          if (isRouteResult(rawResult)) {
            if (rawResult.headers) {
              for (const [hk, hv] of Object.entries(rawResult.headers)) {
                res.setHeader(hk, hv);
              }
            }
            if (rawResult.enableEtag && decl.method === 'GET') {
              const etag = computeListEtag(rawResult.body);
              res.setHeader('ETag', etag);
              const ifNoneMatch = req.headers['if-none-match'];
              if (ifNoneMatch && ifNoneMatch.trim() === etag) {
                res.status(304).end();
                return;
              }
            }
            res.status(rawResult.status ?? 200).json(rawResult.body);
            return;
          }

          res.status(200).json(rawResult);
        } catch (err) {
          next(err);
        } finally {
          if (dbStats.roundTrips > 0) {
            logger.info('API request DB stats', {
              requestId,
              method: decl.method,
              path: decl.path,
              queries: dbStats.queries,
              roundTrips: dbStats.roundTrips,
              dbMs: Number(dbStats.dbMs.toFixed(2)),
            });
          }
        }
      }
    );
  }
}
