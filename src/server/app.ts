import crypto from 'node:crypto';
import zlib from 'node:zlib';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '@server/config.ts';
import type { DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { mountDeclarativeRoutes } from '@server/platform/http-route.ts';
import { logger } from '@server/platform/logger.ts';
import { recordRateLimitEvent } from '@server/platform/observability.ts';
import { auctionRoutes } from '@server/modules/auction/index.ts';
import { identityRoutes, resolveClientIpFromHeaders } from '@server/modules/identity/index.ts';
import {
  SimpleLruCache,
  invalidateLedgerAuditSqlLruCache,
  ledgerAuditSqlLruCache,
  ledgerRoutes,
  queryAllImportAuditLogsWithLruCache,
  type CachedLedgerAuditPayload,
  type LruCacheStats,
} from '@server/modules/ledger/index.ts';
import { createLotsRoutes, type CatchAssistFn } from '@server/modules/lots/index.ts';
import { masterdataRoutes } from '@server/modules/masterdata/index.ts';
import { notificationsRoutes } from '@server/modules/notifications/index.ts';
import { payoutsRoutes } from '@server/modules/payouts/index.ts';
import { platformRoutes } from '@server/modules/platform/index.ts';
import { reportsRoutes } from '@server/modules/reports/index.ts';
import { syncRoutes } from '@server/modules/sync/index.ts';
import { tenancyRoutes } from '@server/modules/tenancy/index.ts';

export const PLATFORM_CROSS_TENANT_ROUTES = [
  'GET /api/v1/governance/migrations',
  'GET /api/v1/benchmarks/harbours',
  'POST /api/v1/tenants',
  'POST /api/v1/tenants/:tenantId/users',
  'GET /api/v1/ledger/verify',
] as const;

export const resolveClientIp = resolveClientIpFromHeaders;
export {
  SimpleLruCache,
  ledgerAuditSqlLruCache,
  invalidateLedgerAuditSqlLruCache,
  queryAllImportAuditLogsWithLruCache,
  type LruCacheStats,
  type CachedLedgerAuditPayload,
  type CatchAssistFn,
};

export function createEdgeRateLimiters() {
  const makeLimiter = (scope: 'AUTH' | 'API', windowMs: number, limit: number, message: string) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      validate: false,
      keyGenerator: (req: Request) => resolveClientIp(req),
      handler: (req: Request, res: Response) => {
        recordRateLimitEvent({ scope, allowed: false, clientIp: resolveClientIp(req), path: req.originalUrl });
        res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message } });
      },
    });
  return {
    authLimiter: makeLimiter('AUTH', 15 * 60 * 1000, 25, 'Too many authentication attempts from this IP. Please wait 15 minutes before retrying.'),
    apiLimiter: makeLimiter('API', 60 * 1000, 600, 'High-traffic rate limit exceeded. Please throttle API requests.'),
  };
}

export function createApiApp(db: DbPort, runCatchAssist?: CatchAssistFn, platformDb: DbPort = db, readDb: DbPort = db): Express {
  const app = express();
  Object.assign(app.locals, { db, platformDb, readDb });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  const { authLimiter, apiLimiter } = createEdgeRateLimiters();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()) || crypto.randomUUID();
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (config.NODE_ENV === 'production' || !config.AISTUDIO_PREVIEW || req.path.startsWith('/api') || req.path === '/healthz' || req.path === '/readyz') {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      config.NODE_ENV === 'production'
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';"
        : config.AISTUDIO_PREVIEW
          ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.run.app; base-uri 'self';"
          : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self';"
    );
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    else if (req.path.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (req.path === '/' || req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');

    if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
      const origSend = res.send.bind(res);
      res.send = ((body?: unknown) => {
        if ((typeof body === 'string' || Buffer.isBuffer(body)) && Buffer.byteLength(body) >= 1024 && !res.getHeader('Content-Encoding')) {
          res.setHeader('Content-Encoding', 'gzip');
          res.removeHeader('Content-Length');
          return origSend(zlib.gzipSync(body));
        }
        return origSend(body);
      }) as typeof res.send;
    }
    next();
  });

  app.use('/api/v1/auth/otp', authLimiter);
  app.use('/api/v1', (req: Request, _res: Response, next: NextFunction) => {
    recordRateLimitEvent({ scope: 'API', allowed: true, clientIp: resolveClientIp(req), path: req.originalUrl });
    next();
  }, apiLimiter);

  mountDeclarativeRoutes(
    app,
    [...platformRoutes, ...identityRoutes, ...tenancyRoutes, ...masterdataRoutes, ...createLotsRoutes(runCatchAssist), ...auctionRoutes, ...payoutsRoutes, ...ledgerRoutes, ...syncRoutes, ...notificationsRoutes, ...reportsRoutes],
    { db, platformDb, readDb }
  );

  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    logger.error('Unhandled API exception', { path: req.originalUrl, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected internal error occurred.' } });
  });

  return app;
}
