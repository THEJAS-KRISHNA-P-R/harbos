import crypto from 'node:crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '@server/config.ts';
import { auditInTx, withPlatform, withTenant, type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { logger } from '@server/platform/logger.ts';
import {
  formatPrometheusMetrics,
  getObservabilitySnapshot,
  recordRateLimitEvent,
  updateObservedDbCounts,
} from '@server/platform/observability.ts';
import {
  issueOtpChallenge,
  verifyOtpChallenge,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  parseRefreshTokenCookie,
  signAccessJwt,
  verifySupervisorPin,
  requireAuth,
  type AuthenticatedRequest,
} from '@server/platform/auth.ts';
import {
  allocateLotSale,
  createPayoutBatch,
  recordBuyerReceipt,
  verifyTenantLedgerChain,
  executeDualKeyReversal,
  signLotQrPayload,
} from '@server/platform/ledger-service.ts';
import {
  reconcileSinglePayoutBatch,
  executeRobustBulkUtrReconcile,
} from '@server/platform/reconcile-service.ts';
import { DEMO_TENANT_ID } from '@server/platform/seed.ts';
import { GENESIS_PREV_HASH } from '@shared/domain/ledger-hash.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import {
  HARBOUROS_SDK_VERSION,
  signBankNodalWebhookPayload,
  verifyBankNodalWebhookSignature,
  computeCrossHarbourBenchmarks,
  generateExternalSdkStarterCode,
  type BankNodalWebhookPayload,
} from '@shared/sdk/harbouros-sdk.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import type {
  AuctionMode,
  CentreType,
  CommercialMode,
  FloorEnforcement,
  InspectionGrade,
} from '@shared/ids.ts';

/**
 * Explicit allowlist of platform-level SUPER_ADMIN routes permitted to run with
 * `app.platform = 'on'` cross-tenant visibility. All other authenticated routes
 * strictly use the tenant-bound `req.db` attached by `requireAuth`.
 */
export const PLATFORM_CROSS_TENANT_ROUTES = [
  'GET /api/v1/governance/migrations',
  'GET /api/v1/benchmarks/harbours',
  'POST /api/v1/tenants',
  'GET /api/v1/ledger/verify',
] as const;

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

export function resolveClientIp(req: Request): string {
  const forwardedHeader = req.headers['forwarded'];
  const forwardedRaw = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  if (typeof forwardedRaw === 'string' && forwardedRaw.length > 0) {
    const match = /for=(?:"?\[?([^;,\s"\]]+)\]?"?)/i.exec(forwardedRaw);
    if (match?.[1]) {
      return match[1];
    }
  }
  const xffHeader = req.headers['x-forwarded-for'];
  const xffRaw = Array.isArray(xffHeader) ? xffHeader[0] : xffHeader;
  if (typeof xffRaw === 'string' && xffRaw.length > 0) {
    const firstIp = xffRaw.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

export function createEdgeRateLimiters() {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 25,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req: Request) => resolveClientIp(req),
    handler: (req: Request, res: Response) => {
      recordRateLimitEvent({
        scope: 'AUTH',
        allowed: false,
        clientIp: resolveClientIp(req),
        path: req.originalUrl,
      });
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message:
            'Too many authentication attempts from this IP. Please wait 15 minutes before retrying.',
        },
      });
    },
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req: Request) => resolveClientIp(req),
    handler: (req: Request, res: Response) => {
      recordRateLimitEvent({
        scope: 'API',
        allowed: false,
        clientIp: resolveClientIp(req),
        path: req.originalUrl,
      });
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message:
            'High-traffic rate limit exceeded. Please throttle API requests.',
        },
      });
    },
  });

  return { authLimiter, apiLimiter };
}

export interface LruCacheStats {
  size: number;
  maxEntries: number;
  ttlMs: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatioPct: number;
}

export class SimpleLruCache<K, V> {
  private readonly store = new Map<
    K,
    { value: V; expiresAt: number; cachedAtIso: string }
  >();
  public readonly maxEntries: number;
  public readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = Math.max(1, options?.maxEntries ?? 64);
    this.ttlMs = Math.max(100, options?.ttlMs ?? 30_000);
  }

  public get(key: K): { value: V; cachedAtIso: string } | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return { value: entry.value, cachedAtIso: entry.cachedAtIso };
  }

  public set(key: K, value: V): string {
    const nowMs = Date.now();
    const cachedAtIso = new Date(nowMs).toISOString();
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions += 1;
      }
    }
    this.store.set(key, {
      value,
      expiresAt: nowMs + this.ttlMs,
      cachedAtIso,
    });
    return cachedAtIso;
  }

  public invalidate(key: K): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public stats(): LruCacheStats {
    const total = this.hits + this.misses;
    const hitRatioPct =
      total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRatioPct,
    };
  }
}

export interface CachedLedgerAuditPayload {
  auditLogs: ReadonlyArray<Record<string, unknown>>;
  payoutBatches: ReadonlyArray<Record<string, unknown>>;
}

export const ledgerAuditSqlLruCache = new SimpleLruCache<
  string,
  CachedLedgerAuditPayload
>({
  maxEntries: 64,
  ttlMs: 30_000,
});

export function invalidateLedgerAuditSqlLruCache(tenantId?: string): void {
  if (tenantId) {
    ledgerAuditSqlLruCache.invalidate(`${tenantId}:ALL`);
  } else {
    ledgerAuditSqlLruCache.clear();
  }
}

export async function queryAllImportAuditLogsWithLruCache(
  db: DbPort,
  tenantId: string,
  viewFilter = 'ALL'
): Promise<{
  view: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  cachedAtIso: string;
  stats: LruCacheStats;
  auditLogs: ReadonlyArray<Record<string, unknown>>;
  payoutBatches: ReadonlyArray<Record<string, unknown>>;
}> {
  const normalizedView = viewFilter.trim().toUpperCase() || 'ALL';
  const cacheKey = `${tenantId}:ALL`;

  if (normalizedView === 'ALL') {
    const hit = ledgerAuditSqlLruCache.get(cacheKey);
    if (hit) {
      return {
        view: normalizedView,
        cacheStatus: 'HIT',
        cachedAtIso: hit.cachedAtIso,
        stats: ledgerAuditSqlLruCache.stats(),
        auditLogs: hit.value.auditLogs,
        payoutBatches: hit.value.payoutBatches,
      };
    }
  }

  const [batchesRes, auditLogsRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT * FROM ledger.payout_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT a.audit_id, a.tenant_id, a.actor_user_id, COALESCE(u.full_name, a.actor_user_id) AS actor_name,
              a.actor_role, a.action_code, a.target_type, a.target_id, a.details_json, a.created_at
       FROM core.audit_logs a
       LEFT JOIN core.users u ON u.user_id = a.actor_user_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [tenantId]
    ),
  ]);

  let cachedAtIso = new Date().toISOString();
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';
  if (normalizedView === 'ALL') {
    cachedAtIso = ledgerAuditSqlLruCache.set(cacheKey, {
      auditLogs: auditLogsRes.rows,
      payoutBatches: batchesRes.rows,
    });
    cacheStatus = 'MISS';
  }

  return {
    view: normalizedView,
    cacheStatus,
    cachedAtIso,
    stats: ledgerAuditSqlLruCache.stats(),
    auditLogs: auditLogsRes.rows,
    payoutBatches: batchesRes.rows,
  };
}

const AllocateSaleBodySchema = z
  .object({
    sessionId: z.string().min(1),
    auctionMode: z.enum([
      'PHYSICAL_SHOUT',
      'DUTCH_IDEAL',
      'HYBRID_REMOTE',
      'COOP_PROCUREMENT',
      'HMS_DIRECT_TAKEOVER',
    ]),
    auctioneerLicenceId: z.string().min(1),
    buyerId: z.string().min(1),
    boxesAllocated: z.number().int().positive().optional(),
    boxesRequested: z.number().int().positive().optional(),
    pricePerKgPaise: z.union([
      z.number().int().positive(),
      z.string().regex(/^[1-9]\d*$/),
    ]),
    fencingToken: z.number().int().nonnegative(),
    governmentPermissionRef: z.string().optional(),
    idempotencyKey: z.string().optional(),
  })
  .refine(
    (data) =>
      (typeof data.boxesAllocated === 'number' && data.boxesAllocated > 0) ||
      (typeof data.boxesRequested === 'number' && data.boxesRequested > 0),
    {
      message: 'boxesAllocated (or boxesRequested) must be a positive integer',
      path: ['boxesAllocated'],
    }
  );

const InspectLotBodySchema = z
  .object({
    grade: z.enum(['A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT']).optional(),
    inspectionGrade: z.enum(['A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT']).optional(),
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

const BuyerReceiptBodySchema = z.object({
  amountPaise: z.union([
    z.number().int().positive(),
    z.string().regex(/^[1-9]\d*$/),
  ]),
  paymentChannel: z
    .enum(['UPI_ESCROW', 'NEFT', 'RTGS', 'IMPS', 'NODAL_TRANSFER'])
    .optional()
    .default('NEFT'),
  referenceNo: z.string().min(2).max(120).optional(),
  paymentReference: z.string().min(2).max(120).optional(),
});

export function createApiApp(db: DbPort, runCatchAssist?: CatchAssistFn): Express {
  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  const { authLimiter, apiLimiter } = createEdgeRateLimiters();

  // Security headers & request correlation ID
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId =
      (typeof req.headers['x-request-id'] === 'string' &&
        req.headers['x-request-id'].trim()) ||
      crypto.randomUUID();
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api') || req.path === '/healthz' || req.path === '/readyz') {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(), geolocation=()'
    );
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains'
    );
    res.setHeader(
      'Content-Security-Policy',
      config.NODE_ENV === 'production'
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors *; base-uri 'self';"
        : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors *; base-uri 'self';"
    );
    next();
  });

  // Liveness probe (zero DB work, zero config leak)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness probe (lightweight DB ping + latest migration version)
  const handleReadiness = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const migRes = await db.query<{ version: string }>(
        `SELECT version FROM core.schema_migrations ORDER BY version DESC LIMIT 1`
      );
      res.status(200).json({
        status: 'ok',
        service: 'harbouros-api',
        database: {
          status: 'ready',
          migrationVersion: migRes.rows[0]?.version ?? 'none',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  };

  app.get('/readyz', handleReadiness);
  app.get('/api/health', handleReadiness);

  // Protect authentication endpoints against brute-force attacks
  app.use(
    '/api/v1/auth/otp',
    (req: Request, _res: Response, next: NextFunction) => {
      recordRateLimitEvent({
        scope: 'AUTH',
        allowed: true,
        clientIp: resolveClientIp(req),
        path: req.originalUrl,
      });
      next();
    },
    authLimiter
  );

  // Protect all /api/v1/* endpoints against high-traffic abuse
  app.use(
    '/api/v1',
    (req: Request, _res: Response, next: NextFunction) => {
      recordRateLimitEvent({
        scope: 'API',
        allowed: true,
        clientIp: resolveClientIp(req),
        path: req.originalUrl,
      });
      next();
    },
    apiLimiter
  );

  // Demo Operators Directory (Strictly gated behind DEMO_MODE && NODE_ENV !== 'production'; 404 otherwise)
  app.get(
    '/api/v1/demo/operators',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'API route not found',
            },
          });
          return;
        }
        const operators = await withPlatform(db, async (tx) => {
          const uRes = await tx.query<{
            user_id: string;
            tenant_id: string;
            phone_e164: string;
            full_name: string;
            role: Role;
          }>(
            `SELECT user_id, tenant_id, phone_e164, full_name, role
             FROM core.users
             WHERE tenant_id = $1 AND is_active = true
             ORDER BY user_id ASC`,
            [DEMO_TENANT_ID]
          );
          return uRes.rows.map((u) => ({
            userId: u.user_id,
            tenantId: u.tenant_id,
            phoneE164: u.phone_e164,
            fullName: u.full_name,
            role: u.role,
          }));
        });
        res.status(200).json({ operators });
      } catch (err) {
        next(err);
      }
    }
  );

  // Authenticated Real Process & SQL Metrics Endpoint (SUPER_ADMIN / HARBOUR_ADMIN only)
  app.get(
    '/api/v1/metrics',
    requireAuth(['SUPER_ADMIN', 'HARBOUR_ADMIN']),
    (req: AuthenticatedRequest, res: Response) => {
      const accept = String(req.headers.accept ?? '');
      if (accept.includes('text/plain')) {
        res
          .status(200)
          .type('text/plain; version=0.0.4; charset=utf-8')
          .send(formatPrometheusMetrics());
        return;
      }
      res
        .status(200)
        .json(getObservabilitySnapshot(ledgerAuditSqlLruCache.stats()));
    }
  );

  // Authenticated Schema Governance Summary (SUPER_ADMIN / HARBOUR_ADMIN only)
  app.get(
    '/api/v1/governance/migrations',
    requireAuth(['SUPER_ADMIN', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const appliedRes = await db.query<{
          version: string;
          checksum: string;
          applied_at: string;
        }>(
          `SELECT version, checksum, applied_at::text AS applied_at
           FROM core.schema_migrations
           ORDER BY version ASC`
        );
        const runner =
          req.auth!.role === 'SUPER_ADMIN'
            ? (fn: (tx: DbPort) => Promise<unknown>) => withPlatform(db, fn)
            : (fn: (tx: DbPort) => Promise<unknown>) => req.db!.transaction(fn);
        const journalBalanceAudit = (await runner((tx) =>
          tx.query<{
            journal_id: string;
            reference_type: string;
            entry_count: string;
            sum_debit_paise: string;
            sum_credit_paise: string;
            is_balanced: boolean;
          }>(
            `SELECT journal_id, reference_type, entry_count::text, sum_debit_paise::text, sum_credit_paise::text, is_balanced
             FROM ledger.v_journal_balance_audit
             ORDER BY journal_id`
          )
        )) as { rows: unknown[] };
        res.status(200).json({
          migrations: appliedRes.rows,
          journalBalanceAudit: journalBalanceAudit.rows,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Multi-Harbour Cross-Tenant Benchmarking & Isomorphic SDK Metadata (Authenticated)
  app.get(
    '/api/v1/benchmarks/harbours',
    requireAuth(['SUPER_ADMIN', 'HARBOUR_ADMIN', 'ACCOUNTANT']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantsRows =
          req.auth!.role === 'SUPER_ADMIN'
            ? await withPlatform(db, async (tx) => {
                const r = await tx.query<{
                  tenant_id: string;
                  name_en: string;
                  centre_type: string;
                }>(
                  `SELECT tenant_id, name_en, centre_type FROM core.tenants ORDER BY created_at ASC`
                );
                return r.rows;
              })
            : (
                await req.db!.query<{
                  tenant_id: string;
                  name_en: string;
                  centre_type: string;
                }>(
                  `SELECT tenant_id, name_en, centre_type FROM core.tenants WHERE tenant_id = $1 ORDER BY created_at ASC`,
                  [req.auth!.tenantId]
                )
              ).rows;
        const benchmarks = computeCrossHarbourBenchmarks(tenantsRows);
        res.status(200).json({
          sdkVersion: HARBOUROS_SDK_VERSION,
          sdkStarterCode: generateExternalSdkStarterCode(),
          harbourCount: benchmarks.length,
          benchmarks,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  const webhookIdempotencyCache = new SimpleLruCache<
    string,
    Record<string, unknown>
  >({
    maxEntries: 256,
    ttlMs: 15 * 60 * 1000,
  });

  // Automated ISO 20022 / NEFT / RTGS Nodal Bank Webhook Callback Endpoint
  app.post(
    '/api/v1/webhooks/bank-nodal',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Partial<BankNodalWebhookPayload> & {
          simulateSigned?: boolean;
        };
        const tenantId = String(body.tenantId || DEMO_TENANT_ID).trim();
        const eventId = String(
          body.eventId || `EVT-NODAL-${crypto.randomUUID()}`
        ).trim();
        const bankCode = String(body.bankCode || 'FDRL-NODAL-KOCHI')
          .trim()
          .toUpperCase();
        const timestampSec =
          typeof body.timestampSec === 'number' && body.timestampSec > 0
            ? body.timestampSec
            : Math.floor(Date.now() / 1000);

        const responsePayload = await withTenant(db, tenantId, async (tenantTx) => {
          let rawSettlements = Array.isArray(body.settlements)
            ? body.settlements
            : [];
          if (rawSettlements.length === 0) {
            const pendingRes = await tenantTx.query<{
              batch_id: string;
              batch_code: string;
              status: string;
            }>(
              `SELECT batch_id, batch_code, status FROM ledger.payout_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
              [tenantId]
            );
            rawSettlements = pendingRes.rows.map((b, idx) => ({
              batchCodeOrId: b.batch_code,
              bankUtr: `FDRL2611099988${String(idx + 10).padStart(2, '0')}`,
              channel: 'ISO20022_CAMT054' as const,
            }));
          }

          const webhookPayload: BankNodalWebhookPayload = {
            eventId,
            bankCode,
            tenantId,
            timestampSec,
            settlements: rawSettlements,
          };

          let signatureHeader = String(
            req.headers['x-harbouros-webhook-signature'] ?? ''
          );
          let timestampHeader = String(
            req.headers['x-harbouros-webhook-timestamp'] ?? ''
          );

          if (
            config.DEMO_MODE &&
            (body.simulateSigned || !signatureHeader)
          ) {
            const signed = signBankNodalWebhookPayload(
              webhookPayload,
              config.QR_HMAC_SECRET
            );
            signatureHeader = signed.headers['X-HarbourOS-Webhook-Signature'];
            timestampHeader = signed.headers['X-HarbourOS-Webhook-Timestamp'];
          }

          const verification = verifyBankNodalWebhookSignature({
            payload: webhookPayload,
            signatureHeader,
            timestampHeader,
            webhookSecret: config.QR_HMAC_SECRET,
          });

          if (!verification.valid) {
            throw new AppError(
              'WEBHOOK_SIGNATURE_INVALID',
              verification.reason,
              401
            );
          }

          const idempotencyKey = String(
            req.headers['idempotency-key'] || `${tenantId}:${eventId}`
          ).trim();
          const cachedHit = webhookIdempotencyCache.get(idempotencyKey);
          if (cachedHit) {
            return {
              ...cachedHit.value,
              idempotentReplay: true,
              cachedAtIso: cachedHit.cachedAtIso,
            };
          }

          const batchesRes = await tenantTx.query<{
            batch_id: string;
            batch_code: string;
          }>(
            `SELECT batch_id, batch_code FROM ledger.payout_batches WHERE tenant_id = $1`,
            [tenantId]
          );

          const matchedItems: Array<{ batchId: string; bankUtr: string }> = [];
          for (const s of webhookPayload.settlements) {
            const ref = s.batchCodeOrId.trim().toUpperCase();
            const found = batchesRes.rows.find(
              (b) =>
                b.batch_code.toUpperCase() === ref ||
                b.batch_id.toUpperCase() === ref
            );
            if (found) {
              matchedItems.push({
                batchId: found.batch_id,
                bankUtr: s.bankUtr.trim().toUpperCase(),
              });
            }
          }

          const reconciled =
            matchedItems.length > 0
              ? await executeRobustBulkUtrReconcile(tenantTx, {
                  tenantId,
                  actorUserId: 'USR-ACCT-01',
                  actorRole: 'ACCOUNTANT',
                  actorFullName: `${bankCode} Nodal Gateway (Webhook)`,
                  headerIdempotencyKey: idempotencyKey,
                  rawBody: {
                    items: matchedItems,
                    sourceLabel: `${bankCode} Webhook (${eventId})`,
                    totalRowsParsed: webhookPayload.settlements.length,
                    invalidOrUnmatchedCount:
                      webhookPayload.settlements.length - matchedItems.length,
                  },
                })
              : {
                  auditId: `AUD-WHK-${crypto.randomUUID()}`,
                  timestampIso: new Date().toISOString(),
                  sourceLabel: `${bankCode} Webhook (${eventId})`,
                  reconciledCount: 0,
                  reconciled: [],
                };

          invalidateLedgerAuditSqlLruCache(tenantId);

          const built: Record<string, unknown> = {
            ok: true,
            eventId,
            bankCode,
            sdkVersion: HARBOUROS_SDK_VERSION,
            signatureVerified: true,
            signatureHex: verification.computedSignatureHex,
            idempotentReplay: false,
            ...reconciled,
          };

          webhookIdempotencyCache.set(idempotencyKey, built);
          return built;
        });

        res.status(200).json(responsePayload);
      } catch (err) {
        next(err);
      }
    }
  );

  // Auth: Request OTP (Zero user/role enumeration: identical 200 response for registered & unknown numbers)
  app.post(
    '/api/v1/auth/otp/request',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawPhone = String(req.body?.phoneE164 ?? '').replace(/\s+/g, '');
        if (!/^\+[1-9]\d{9,14}$/.test(rawPhone)) {
          throw new AppError(
            'VALIDATION_ERROR',
            'phoneE164 must be a valid E.164 phone number starting with +',
            400
          );
        }

        const { user, challenge } = await withPlatform(db, async (tx) => {
          const userRes = await tx.query<{
            user_id: string;
            tenant_id: string;
            full_name: string;
            role: Role;
          }>(
            `SELECT user_id, tenant_id, full_name, role
             FROM core.users
             WHERE phone_e164 = $1 AND is_active = true
             LIMIT 1`,
            [rawPhone]
          );
          const foundUser = userRes.rows[0];

          // Always issue a challenge row so timing and lockout behavior are uniform
          const issuedChallenge = await issueOtpChallenge(tx, rawPhone);

          if (foundUser) {
            await tx.query(
              `INSERT INTO sync.outbox_events (event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at)
               VALUES ($1, $2, 'SMS', $3, 'OTP_LOGIN', $4, 'DISPATCHED_CONSOLE', $5)`,
              [
                `OTP-${crypto.randomUUID()}`,
                foundUser.tenant_id,
                rawPhone,
                JSON.stringify({ challengeId: issuedChallenge.challengeId }),
                new Date().toISOString(),
              ]
            );
          }

          return { user: foundUser, challenge: issuedChallenge };
        });

        res.status(200).json({
          status: 'OTP_CHALLENGE_ISSUED',
          message:
            'If this phone number is registered, a 6-digit OTP has been dispatched.',
          ...(config.OTP_DEV_ECHO && user
            ? { devOtpEcho: challenge.otpCode }
            : {}),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Auth: Verify OTP & issue 15m HS256 JWT + 14d rotating HttpOnly refresh token cookie
  app.post(
    '/api/v1/auth/otp/verify',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawPhone = String(req.body?.phoneE164 ?? '').replace(/\s+/g, '');
        const otpCode = String(req.body?.otpCode ?? '').trim();
        if (!rawPhone || !otpCode) {
          throw new AppError(
            'VALIDATION_ERROR',
            'phoneE164 and otpCode are required',
            400
          );
        }

        const verified = await verifyOtpChallenge(db, rawPhone, otpCode);
        if (!verified) {
          throw new AppError(
            'UNAUTHORIZED',
            'Invalid or expired OTP code',
            401
          );
        }

        const user = await withPlatform(db, async (tx) => {
          const userRes = await tx.query<{
            user_id: string;
            tenant_id: string;
            phone_e164: string;
            full_name: string;
            role: Role;
            entity_ref_id: string | null;
          }>(
            `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id
             FROM core.users
             WHERE phone_e164 = $1 AND is_active = true
             LIMIT 1`,
            [rawPhone]
          );
          return userRes.rows[0] ?? null;
        });

        if (!user) {
          throw new AppError(
            'UNAUTHORIZED',
            'Invalid or expired OTP code',
            401
          );
        }

        const accessToken = await signAccessJwt({
          sub: user.user_id,
          tenantId: user.tenant_id,
          role: user.role,
          fullName: user.full_name,
          phoneE164: user.phone_e164,
          entityRefId: user.entity_ref_id,
        });

        const refresh = await issueRefreshToken(db, {
          userId: user.user_id,
          tenantId: user.tenant_id,
        });
        setRefreshTokenCookie(res, refresh.rawToken);

        res.status(200).json({
          accessToken,
          user: {
            userId: user.user_id,
            tenantId: user.tenant_id,
            phoneE164: user.phone_e164,
            fullName: user.full_name,
            role: user.role,
            entityRefId: user.entity_ref_id,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Auth: Rotate Refresh Token Cookie & Issue Fresh Access JWT (Revokes family on reuse)
  app.post(
    '/api/v1/auth/refresh',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawCookie = parseRefreshTokenCookie(req);
        if (!rawCookie) {
          throw new AppError('UNAUTHORIZED', 'Missing refresh token cookie', 401);
        }
        const rotated = await rotateRefreshToken(db, rawCookie);
        setRefreshTokenCookie(res, rotated.newRawRefreshToken);
        res.status(200).json({
          accessToken: rotated.accessToken,
          user: rotated.user,
        });
      } catch (err) {
        clearRefreshTokenCookie(res);
        next(err);
      }
    }
  );

  // Auth: Logout & Revoke Refresh Token
  app.post(
    '/api/v1/auth/logout',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawCookie = parseRefreshTokenCookie(req);
        if (rawCookie) {
          await revokeRefreshToken(db, rawCookie);
        }
        clearRefreshTokenCookie(res);
        res.status(200).json({ loggedOut: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // Demo Persona Switcher (Strictly gated behind DEMO_MODE && NODE_ENV !== 'production')
  app.post(
    '/api/v1/auth/persona-switch',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
          throw new AppError(
            'FORBIDDEN',
            'Demo persona switcher is disabled in production',
            403
          );
        }
        const role = String(req.body?.role ?? 'HARBOUR_ADMIN') as Role;
        const requestedTenantId = String(req.body?.tenantId ?? DEMO_TENANT_ID);

        const user = await withPlatform(db, async (tx) => {
          const userRes = await tx.query<{
            user_id: string;
            tenant_id: string;
            phone_e164: string;
            full_name: string;
            role: Role;
            entity_ref_id: string | null;
          }>(
            `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id
             FROM core.users WHERE role = $1 AND is_active = true ORDER BY tenant_id = $2 DESC LIMIT 1`,
            [role, requestedTenantId]
          );
          return userRes.rows[0] ?? null;
        });

        if (!user) {
          throw new AppError(
            'NOT_FOUND',
            `No persona found for role ${role}`,
            404
          );
        }

        const effectiveTenantId =
          role === 'SUPER_ADMIN' && requestedTenantId
            ? requestedTenantId
            : user.tenant_id;

        const accessToken = await signAccessJwt({
          sub: user.user_id,
          tenantId: effectiveTenantId,
          role: user.role,
          fullName: user.full_name,
          phoneE164: user.phone_e164,
          entityRefId: user.entity_ref_id,
        });

        const refresh = await issueRefreshToken(db, {
          userId: user.user_id,
          tenantId: effectiveTenantId,
        });
        setRefreshTokenCookie(res, refresh.rawToken);

        res.status(200).json({
          accessToken,
          user: {
            userId: user.user_id,
            tenantId: effectiveTenantId,
            phoneE164: user.phone_e164,
            fullName: user.full_name,
            role: user.role,
            entityRefId: user.entity_ref_id,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Authenticated User Profile
  app.get(
    '/api/v1/me',
    requireAuth(),
    (req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({ user: req.auth });
    }
  );

  // Authenticated Operator Profile & Personal Audit Trail
  app.get(
    '/api/v1/auth/profile',
    requireAuth(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.auth!.sub;
        const tenantId = req.auth!.tenantId;
        const [uRes, auditRes] = await Promise.all([
          req.db!.query(
            `SELECT u.user_id, u.tenant_id, COALESCE(t.name_en, 'Munambam HMS') AS tenant_name_en,
                    COALESCE(t.name_ml, '') AS tenant_name_ml,
                    u.phone_e164, u.full_name, u.role, u.entity_ref_id, u.is_active,
                    COALESCE(t.created_at::text, '2026-04-01T00:00:00Z') AS created_at
             FROM core.users u
             LEFT JOIN core.tenants t ON t.tenant_id = u.tenant_id
             WHERE u.user_id = $1 AND u.tenant_id = $2
             LIMIT 1`,
            [userId, tenantId]
          ),
          req.db!.query(
            `SELECT audit_id, action_code, target_type, target_id, details_json, created_at
             FROM core.audit_logs
             WHERE actor_user_id = $1 AND tenant_id = $2
             ORDER BY created_at DESC
             LIMIT 15`,
            [userId, tenantId]
          ),
        ]);
        if (!uRes.rows[0]) {
          throw new AppError(
            'NOT_FOUND',
            'Authenticated operator record not found',
            404
          );
        }
        res.status(200).json({
          profile: uRes.rows[0],
          claims: req.auth,
          recentAudit: auditRes.rows,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update Authenticated Operator Profile
  app.post(
    '/api/v1/auth/profile',
    requireAuth(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const fullName = String(req.body?.fullName ?? '').trim();
        const phoneE164 = String(req.body?.phoneE164 ?? '')
          .trim()
          .replace(/\s+/g, '');
        if (fullName.length < 2) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Full name must be at least 2 characters',
            400
          );
        }
        if (!/^\+[1-9]\d{9,14}$/.test(phoneE164)) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Phone number must be in E.164 format starting with +',
            400
          );
        }
        const claims = req.auth!;
        await req.db!.transaction(async (tx) => {
          await tx.query(
            `UPDATE core.users SET full_name = $1, phone_e164 = $2 WHERE user_id = $3 AND tenant_id = $4`,
            [fullName, phoneE164, claims.sub, claims.tenantId]
          );
          await auditInTx(tx, {
            tenantId: claims.tenantId,
            actorUserId: claims.sub,
            actorRole: claims.role,
            actionCode: 'USER_PROFILE_UPDATED',
            targetType: 'USER',
            targetId: claims.sub,
            details: { fullName, phoneE164 },
          });
        });
        const accessToken = await signAccessJwt({
          sub: claims.sub,
          tenantId: claims.tenantId,
          role: claims.role,
          fullName,
          phoneE164,
          entityRefId: claims.entityRefId ?? null,
        });
        res.status(200).json({
          accessToken,
          user: {
            userId: claims.sub,
            tenantId: claims.tenantId,
            phoneE164,
            fullName,
            role: claims.role,
            entityRefId: claims.entityRefId ?? null,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Bootstrap Workspace State (Strictly scoped to req.auth.tenantId and req.auth.role via req.db)
  app.get(
    '/api/v1/bootstrap',
    requireAuth(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const claims = req.auth!;
        const tenantId = claims.tenantId;
        const role = claims.role;
        const entityRefId = claims.entityRefId ?? null;

        const payload = await req.db!.transaction(async (tx) => {
          const [
            tenantRes,
            allTenantsRes,
            policiesRes,
            usersRes,
            societiesRes,
            fishermenRes,
            vesselsRes,
            licencesRes,
            buyersRes,
            speciesRes,
            lotsRes,
            sessionsRes,
            allocationsRes,
            accountsRes,
            journalsRes,
            entriesRes,
            reversalsRes,
            outboxRes,
            cachedAuditAndBatches,
            chainVerification,
          ] = await Promise.all([
            tx.query(`SELECT * FROM core.tenants WHERE tenant_id = $1`, [
              tenantId,
            ]),
            tx.query(`SELECT * FROM core.tenants WHERE tenant_id = $1`, [
              tenantId,
            ]),
            tx.query(
              `SELECT * FROM core.commission_policies WHERE tenant_id = $1 ORDER BY version_num DESC`,
              [tenantId]
            ),
            tx.query(
              `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id, is_active FROM core.users WHERE tenant_id = $1`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM harbour.coop_societies WHERE tenant_id = $1`,
              [tenantId]
            ),
            tx.query(`SELECT * FROM harbour.fishermen WHERE tenant_id = $1`, [
              tenantId,
            ]),
            tx.query(`SELECT * FROM harbour.vessels WHERE tenant_id = $1`, [
              tenantId,
            ]),
            tx.query(
              `SELECT * FROM harbour.auctioneer_licences WHERE tenant_id = $1`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM harbour.buyers WHERE tenant_id = $1 ORDER BY paddle_no ASC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM harbour.species WHERE tenant_id = $1 ORDER BY code ASC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM auction.lots WHERE tenant_id = $1 ORDER BY created_at DESC`,
              [tenantId]
            ),
            tx.query(`SELECT * FROM auction.sessions WHERE tenant_id = $1`, [
              tenantId,
            ]),
            tx.query(
              `SELECT * FROM auction.sale_allocations WHERE tenant_id = $1 ORDER BY created_at DESC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM ledger.accounts WHERE tenant_id = $1 ORDER BY code ASC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM ledger.journals WHERE tenant_id = $1 ORDER BY created_at DESC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM ledger.entries WHERE tenant_id = $1 ORDER BY entry_seq DESC LIMIT 80`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM ledger.reversal_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
              [tenantId]
            ),
            tx.query(
              `SELECT * FROM sync.outbox_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`,
              [tenantId]
            ),
            queryAllImportAuditLogsWithLruCache(tx, tenantId, 'ALL'),
            verifyTenantLedgerChain(tx, tenantId),
          ]);

          updateObservedDbCounts({
            tenantsCount: allTenantsRes.rows.length,
            usersCount: usersRes.rows.length,
          });

          // Role-scoped PII & financial data filtering (T12)
          const isFisherman = role === 'FISHERMAN_BOAT_OWNER';
          const isBuyer = role === 'WHOLESALE_BUYER';
          const isAdminOrAccountant =
            role === 'SUPER_ADMIN' ||
            role === 'HARBOUR_ADMIN' ||
            role === 'ACCOUNTANT';

          const scopedFishermen = isFisherman
            ? fishermenRes.rows.filter(
                (f) => String(f.fisherman_id) === String(entityRefId)
              )
            : fishermenRes.rows;

          const scopedVessels = isFisherman
            ? vesselsRes.rows.filter(
                (v) => String(v.owner_fisherman_id) === String(entityRefId)
              )
            : vesselsRes.rows;

          const scopedBuyers = isFisherman
            ? []
            : isBuyer && entityRefId
              ? buyersRes.rows.filter(
                  (b) => String(b.buyer_id) === String(entityRefId)
                )
              : buyersRes.rows;

          const scopedUsers = isAdminOrAccountant
            ? usersRes.rows
            : usersRes.rows.filter((u) => String(u.user_id) === claims.sub);

          return {
            cachedAuditAndBatches,
            body: {
              tenant: tenantRes.rows[0] ?? null,
              allTenants: allTenantsRes.rows,
              policies: policiesRes.rows,
              users: scopedUsers,
              societies: societiesRes.rows,
              fishermen: scopedFishermen,
              vessels: scopedVessels,
              licences: licencesRes.rows,
              buyers: scopedBuyers,
              species: speciesRes.rows,
              lots: lotsRes.rows,
              sessions: sessionsRes.rows,
              allocations: allocationsRes.rows,
              accounts: accountsRes.rows,
              journals: journalsRes.rows,
              entries: entriesRes.rows,
              reversals: reversalsRes.rows,
              payoutBatches: cachedAuditAndBatches.payoutBatches,
              outboxEvents: outboxRes.rows,
              auditLogs: cachedAuditAndBatches.auditLogs,
              ledgerVerification: chainVerification,
              auditSqlLruCache: {
                cacheStatus: cachedAuditAndBatches.cacheStatus,
                cachedAtIso: cachedAuditAndBatches.cachedAtIso,
                stats: cachedAuditAndBatches.stats,
              },
            },
          };
        });

        res.setHeader(
          'X-SQL-LRU-Cache',
          payload.cachedAuditAndBatches.cacheStatus
        );
        res.status(200).json(payload.body);
      } catch (err) {
        next(err);
      }
    }
  );

  // Dedicated SQL LRU Cached Endpoint for LedgerInspectorDrawer
  app.get(
    '/api/v1/ledger/audit-imports',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const view = String(req.query.view ?? 'ALL').toUpperCase();
        const result = await req.db!.transaction((tx) =>
          queryAllImportAuditLogsWithLruCache(tx, tenantId, view)
        );
        res.setHeader('X-SQL-LRU-Cache', result.cacheStatus);
        res.status(200).json({
          tenantId,
          view: result.view,
          cacheStatus: result.cacheStatus,
          cachedAtIso: result.cachedAtIso,
          stats: result.stats,
          auditLogs: result.auditLogs,
          payoutBatches: result.payoutBatches,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Weighing Workspace: Create & Tag Lot (Phase A2: creates WEIGHED_PENDING_INSPECTION with inspection_grade = NULL)
  app.post(
    '/api/v1/lots',
    requireAuth(['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const vesselId = String(req.body?.vesselId ?? '').trim();
        const speciesId = String(req.body?.speciesId ?? '').trim();
        const totalBoxes = Number(req.body?.totalBoxes ?? 0);
        const netGrams = BigInt(req.body?.netGrams ?? 0);
        const coreTempC = Number(req.body?.coreTempC ?? 2.0);
        const rawWeightSource = String(req.body?.weightSource ?? 'MANUAL').trim();
        const weightSource: 'MANUAL' | 'BLE_SCALE' =
          rawWeightSource === 'BLE_SCALE' ? 'BLE_SCALE' : 'MANUAL';
        const supervisorPin = String(req.body?.supervisorPin ?? '');

        if (
          !vesselId ||
          !speciesId ||
          !Number.isInteger(totalBoxes) ||
          totalBoxes <= 0 ||
          netGrams <= 0n
        ) {
          throw new AppError(
            'VALIDATION_ERROR',
            'vesselId, speciesId, totalBoxes > 0, and netGrams > 0 are required',
            400
          );
        }

        const created = await req.db!.transaction(async (tx) => {
          if (weightSource === 'MANUAL') {
            const pinRows = await tx.query<{
              pin_code: string | null;
              supervisor_pin_hash: string | null;
            }>(
              `SELECT pin_code, supervisor_pin_hash
               FROM core.users
               WHERE tenant_id = $1 AND role IN ('WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN') AND is_active = true`,
              [tenantId]
            );
            const pinAuthorized = pinRows.rows.some((r) =>
              verifySupervisorPin(
                supervisorPin,
                r.supervisor_pin_hash,
                r.pin_code
              )
            );
            if (!pinAuthorized) {
              throw new AppError(
                'FORBIDDEN',
                'Valid supervisor PIN required for manual scale weight override.',
                403
              );
            }
          }

          const vesselRes = await tx.query<{ owner_fisherman_id: string }>(
            `SELECT owner_fisherman_id FROM harbour.vessels WHERE vessel_id = $1 AND tenant_id = $2`,
            [vesselId, tenantId]
          );
          const vessel = vesselRes.rows[0];
          if (!vessel) {
            throw new AppError(
              'NOT_FOUND',
              'Vessel not found in this harbour',
              404
            );
          }

          const countRes = await tx.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt FROM auction.lots WHERE tenant_id = $1`,
            [tenantId]
          );
          const seqNum = (countRes.rows[0]?.cnt ?? 0) + 1;
          const lotId = `LOT-2026-${String(seqNum).padStart(3, '0')}`;
          const lotCode = `MUN-261106-${String(seqNum).padStart(3, '0')}`;
          const qrSignature = signLotQrPayload(
            lotId,
            vesselId,
            netGrams,
            config.QR_HMAC_SECRET
          );
          const nowIso = new Date().toISOString();

          await tx.query(
            `INSERT INTO auction.lots (
              lot_id, tenant_id, lot_code, vessel_id, fisherman_id, species_id,
              sale_unit_type, total_boxes, available_boxes, net_grams, available_grams,
              core_temp_c, inspection_grade, inspection_notes, inspected_by_user_id, weighed_by_user_id,
              weight_source, qr_signature, status, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              'BOX', $7, $7, $8, $8,
              $9, NULL, 'Weighed at dockside terminal; awaiting quality inspection', NULL, $10,
              $11, $12, 'WEIGHED_PENDING_INSPECTION', $13
            )`,
            [
              lotId,
              tenantId,
              lotCode,
              vesselId,
              vessel.owner_fisherman_id,
              speciesId,
              totalBoxes,
              netGrams.toString(),
              coreTempC,
              req.auth!.sub,
              weightSource,
              qrSignature,
              nowIso,
            ]
          );

          await auditInTx(tx, {
            tenantId,
            actorUserId: req.auth!.sub,
            actorRole: req.auth!.role,
            actionCode: 'LOT_WEIGHED_AND_TAGGED',
            targetType: 'LOT',
            targetId: lotId,
            details: {
              lotCode,
              weightSource,
              netGrams: netGrams.toString(),
              qrSignature,
              status: 'WEIGHED_PENDING_INSPECTION',
            },
          });

          return {
            lotId,
            lotCode,
            qrSignature,
            netGrams: netGrams.toString(),
            totalBoxes,
            status: 'WEIGHED_PENDING_INSPECTION' as const,
            inspectionGrade: null,
          };
        });

        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  // Offline Queue Sync Endpoint (Phase A2: requires all fields, no silent defaults, creates WEIGHED_PENDING_INSPECTION)
  app.post(
    '/api/v1/sync/commands',
    requireAuth(['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const commands = Array.isArray(req.body?.commands)
          ? req.body.commands
          : [];
        if (commands.length === 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            'commands array with at least one command is required',
            400
          );
        }

        const results = await req.db!.transaction(async (tx) => {
          const out: Array<{
            commandId: string;
            status: string;
            lotId?: string;
            lotCode?: string;
            lotStatus?: string;
            inspectionGrade?: string | null;
          }> = [];

          for (const cmd of commands) {
            const commandId = String(cmd?.commandId ?? '').trim();
            const vesselId = String(cmd?.vesselId ?? '').trim();
            const speciesId = String(cmd?.speciesId ?? '').trim();
            const totalBoxes = Number(cmd?.totalBoxes ?? 0);
            let netGrams = 0n;
            try {
              netGrams = BigInt(cmd?.netGrams ?? 0);
            } catch {
              netGrams = 0n;
            }

            if (
              !commandId ||
              !vesselId ||
              !speciesId ||
              !Number.isInteger(totalBoxes) ||
              totalBoxes <= 0 ||
              netGrams <= 0n
            ) {
              throw new AppError(
                'VALIDATION_ERROR',
                'Each sync command requires commandId, vesselId, speciesId, totalBoxes > 0, and netGrams > 0',
                400
              );
            }

            const existing = await tx.query<{
              status: string;
              result_ref_id: string | null;
            }>(
              `SELECT status, result_ref_id FROM sync.client_commands WHERE command_id = $1 AND tenant_id = $2`,
              [commandId, tenantId]
            );
            if (existing.rows[0]) {
              out.push({
                commandId,
                status: existing.rows[0].status,
                ...(existing.rows[0].result_ref_id
                  ? { lotCode: existing.rows[0].result_ref_id }
                  : {}),
              });
              continue;
            }

            const vesselRes = await tx.query<{ owner_fisherman_id: string }>(
              `SELECT owner_fisherman_id FROM harbour.vessels WHERE vessel_id = $1 AND tenant_id = $2`,
              [vesselId, tenantId]
            );
            const vessel = vesselRes.rows[0];
            if (!vessel) {
              throw new AppError(
                'NOT_FOUND',
                `Vessel ${vesselId} not found in tenant ${tenantId}`,
                404
              );
            }

            const countRes = await tx.query<{ cnt: number }>(
              `SELECT COUNT(*)::int AS cnt FROM auction.lots WHERE tenant_id = $1`,
              [tenantId]
            );
            const seqNum = (countRes.rows[0]?.cnt ?? 0) + 1;
            const lotId = `LOT-SYNC-${seqNum}-${commandId.slice(-4)}`;
            const lotCode = `MUN-SYNC-${String(seqNum).padStart(3, '0')}`;
            const qrSignature = signLotQrPayload(
              lotId,
              vesselId,
              netGrams,
              config.QR_HMAC_SECRET
            );
            const nowIso = new Date().toISOString();
            const weightSource: 'MANUAL' | 'BLE_SCALE' =
              cmd?.weightSource === 'MANUAL' ? 'MANUAL' : 'BLE_SCALE';

            await tx.query(
              `INSERT INTO auction.lots (
                lot_id, tenant_id, lot_code, vessel_id, fisherman_id, species_id,
                sale_unit_type, total_boxes, available_boxes, net_grams, available_grams,
                core_temp_c, inspection_grade, inspection_notes, inspected_by_user_id, weighed_by_user_id,
                weight_source, qr_signature, status, created_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'BOX', $7, $7, $8, $8,
                2.0, NULL, 'Synced from offline dockside queue; awaiting inspection', NULL, $9,
                $10, $11, 'WEIGHED_PENDING_INSPECTION', $12
              )`,
              [
                lotId,
                tenantId,
                lotCode,
                vesselId,
                vessel.owner_fisherman_id,
                speciesId,
                totalBoxes,
                netGrams.toString(),
                req.auth!.sub,
                weightSource,
                qrSignature,
                nowIso,
              ]
            );

            await tx.query(
              `INSERT INTO sync.client_commands (command_id, tenant_id, device_id, command_type, status, result_ref_id, created_at)
               VALUES ($1, $2, $3, 'TAG_LOT', 'APPLIED', $4, $5)`,
              [
                commandId,
                tenantId,
                String(cmd.deviceId ?? 'TAB-WEIGH-01'),
                lotCode,
                nowIso,
              ]
            );

            await auditInTx(tx, {
              tenantId,
              actorUserId: req.auth!.sub,
              actorRole: req.auth!.role,
              actionCode: 'LOT_SYNCED_PENDING_INSPECTION',
              targetType: 'LOT',
              targetId: lotId,
              details: {
                commandId,
                lotCode,
                vesselId,
                speciesId,
                totalBoxes,
                netGrams: netGrams.toString(),
                status: 'WEIGHED_PENDING_INSPECTION',
              },
            });

            out.push({
              commandId,
              status: 'APPLIED',
              lotId,
              lotCode,
              lotStatus: 'WEIGHED_PENDING_INSPECTION',
              inspectionGrade: null,
            });
          }

          return out;
        });

        res.status(200).json({ syncedCount: results.length, results });
      } catch (err) {
        next(err);
      }
    }
  );

  // Quality Inspector: Grade Lot under Section 21 (Phase A2: enforces independent inspector & blocks post-allocation re-inspection)
  app.post(
    '/api/v1/lots/:lotId/inspect',
    requireAuth(['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const parsed = InspectLotBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION_ERROR',
            parsed.error.issues[0]?.message ?? 'Invalid inspection payload',
            400
          );
        }

        const tenantId = req.auth!.tenantId;
        const lotId = String(req.params.lotId ?? '');
        const { coreTempC, notes, overrideReason } = parsed.data;
        const grade = (parsed.data.grade ?? parsed.data.inspectionGrade)!;
        const newStatus =
          grade === 'REJECTED_UNFIT' ? 'BLOCKED_UNFIT' : 'OPEN_FOR_AUCTION';

        const updatedLot = await req.db!.transaction(async (tx) => {
          const lotRes = await tx.query<{
            lot_id: string;
            lot_code: string;
            status: string;
            weighed_by_user_id: string | null;
          }>(
            `SELECT lot_id, lot_code, status, weighed_by_user_id
             FROM auction.lots
             WHERE lot_id = $1 AND tenant_id = $2
             FOR UPDATE`,
            [lotId, tenantId]
          );
          const existingLot = lotRes.rows[0];
          if (!existingLot) {
            throw new AppError(
              'NOT_FOUND',
              `Lot ${lotId} not found in tenant ${tenantId}`,
              404
            );
          }

          // Block self-inspection unless HARBOUR_ADMIN provides explicit overrideReason
          if (
            existingLot.weighed_by_user_id &&
            existingLot.weighed_by_user_id === req.auth!.sub
          ) {
            const canOverride =
              req.auth!.role === 'HARBOUR_ADMIN' &&
              typeof overrideReason === 'string' &&
              overrideReason.trim().length >= 5;
            if (!canOverride) {
              throw new AppError(
                'SELF_INSPECTION_FORBIDDEN',
                `Independent quality gate (${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE}): Operator who weighed the lot cannot perform Section 21 inspection.`,
                403
              );
            }
          }

          // Forbid re-inspection once any sale allocation exists
          const allocRes = await tx.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt FROM auction.sale_allocations WHERE lot_id = $1 AND tenant_id = $2`,
            [lotId, tenantId]
          );
          if (
            (allocRes.rows[0]?.cnt ?? 0) > 0 ||
            existingLot.status === 'PARTIALLY_SOLD' ||
            existingLot.status === 'FULLY_SOLD'
          ) {
            throw new AppError(
              'CONFLICT',
              `Lot ${existingLot.lot_code} already has sale allocations and cannot be re-inspected.`,
              409
            );
          }

          const updRes = await tx.query<{ lot_id: string; status: string }>(
            `UPDATE auction.lots
             SET inspection_grade = $1, core_temp_c = $2, inspection_notes = $3,
                 inspected_by_user_id = $4, status = $5
             WHERE lot_id = $6 AND tenant_id = $7
             RETURNING lot_id, status`,
            [
              grade as InspectionGrade,
              coreTempC,
              notes,
              req.auth!.sub,
              newStatus,
              lotId,
              tenantId,
            ]
          );

          await auditInTx(tx, {
            tenantId,
            actorUserId: req.auth!.sub,
            actorRole: req.auth!.role,
            actionCode:
              grade === 'REJECTED_UNFIT'
                ? 'QUALITY_INSPECTION_REJECTED_S21'
                : 'QUALITY_INSPECTION_PASSED_S21',
            targetType: 'LOT',
            targetId: lotId,
            details: {
              actorName: req.auth!.fullName,
              grade,
              coreTempC,
              status: newStatus,
              statutoryRef: ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE,
              ...(overrideReason ? { overrideReason } : {}),
            },
          });

          return updRes.rows[0]!;
        });

        res.status(200).json({
          lotId: updatedLot.lot_id,
          grade,
          coreTempC,
          status: updatedLot.status,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Inspector Optional AI Assist (ADR-009: advisory only, never auto-grades, returns UNAVAILABLE when off)
  app.post(
    '/api/v1/lots/:lotId/ai-assist',
    requireAuth(['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const speciesNameEn = String(req.body?.speciesNameEn ?? 'Marine Catch');
        const coreTempC = Number(req.body?.coreTempC ?? 2.0);
        const inspectorNotes = String(req.body?.inspectorNotes ?? '');
        if (!runCatchAssist) {
          res.status(200).json({
            available: false,
            advisoryDisclaimer:
              'AI suggestion — inspector must confirm (ADR-009). Status: UNAVAILABLE.',
          });
          return;
        }
        const result = await runCatchAssist({
          speciesNameEn,
          coreTempC,
          inspectorNotes,
        });
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Pit Workspace: Allocate Lot Sale
  app.post(
    '/api/v1/lots/:lotId/allocate',
    requireAuth(['LICENSED_AUCTIONEER', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const parsed = AllocateSaleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION_ERROR',
            parsed.error.issues[0]?.message ?? 'Invalid sale allocation payload',
            400
          );
        }

        const data = parsed.data;
        const tenantId = req.auth!.tenantId;
        const lotId = String(req.params.lotId ?? '');
        const boxesRequested =
          data.boxesAllocated ?? data.boxesRequested ?? 0;
        const pricePerKgPaise = BigInt(data.pricePerKgPaise);

        const rawIdemHeader = req.headers['idempotency-key'];
        const idempotencyKey = String(
          (Array.isArray(rawIdemHeader) ? rawIdemHeader[0] : rawIdemHeader) ??
            data.idempotencyKey ??
            ''
        ).trim();

        if (!idempotencyKey) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Idempotency-Key header (or idempotencyKey field) is required for financial sale allocations.',
            400
          );
        }

        if (
          req.auth!.role === 'LICENSED_AUCTIONEER' &&
          req.auth!.entityRefId &&
          req.auth!.entityRefId !== data.auctioneerLicenceId
        ) {
          throw new AppError(
            'FORBIDDEN',
            `Licensed auctioneer (${req.auth!.sub}) is bound to licence ${req.auth!.entityRefId} and cannot impersonate licence ${data.auctioneerLicenceId}.`,
            403
          );
        }

        const result = await allocateLotSale(req.db!, {
          tenantId,
          lotId,
          sessionId: data.sessionId,
          auctionMode: data.auctionMode as AuctionMode,
          auctioneerLicenceId: data.auctioneerLicenceId,
          buyerId: data.buyerId,
          boxesRequested,
          pricePerKgPaise,
          idempotencyKey,
          fencingToken: data.fencingToken,
          ...(data.governmentPermissionRef
            ? { governmentPermissionRef: data.governmentPermissionRef }
            : {}),
          nowIso: new Date().toISOString(),
        });

        invalidateLedgerAuditSqlLruCache(tenantId);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Harbour Admin: Update Section 19 Floor Price & Enforcement Mode
  app.post(
    '/api/v1/floor-prices',
    requireAuth(['HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        await req.db!.transaction(async (tx) => {
          if (req.body?.floorEnforcement) {
            const mode = String(req.body.floorEnforcement) as FloorEnforcement;
            await tx.query(
              `UPDATE core.tenants SET floor_enforcement = $1 WHERE tenant_id = $2`,
              [mode, tenantId]
            );
          }
          if (
            req.body?.speciesId &&
            req.body?.floorPricePaisePerKg !== undefined
          ) {
            const floorVal = BigInt(req.body.floorPricePaisePerKg);
            if (floorVal <= 0n) {
              throw new AppError(
                'VALIDATION_ERROR',
                'floorPricePaisePerKg must be > 0',
                400
              );
            }
            await tx.query(
              `UPDATE harbour.species SET floor_price_paise_per_kg = $1 WHERE species_id = $2 AND tenant_id = $3`,
              [floorVal.toString(), String(req.body.speciesId), tenantId]
            );
          }
          await auditInTx(tx, {
            tenantId,
            actorUserId: req.auth!.sub,
            actorRole: req.auth!.role,
            actionCode: 'FLOOR_SCHEDULE_UPDATED_S19',
            targetType: 'SPECIES',
            targetId: String(req.body?.speciesId ?? 'TENANT-FLOOR-MODE'),
            details: {
              actorName: req.auth!.fullName,
              floorEnforcement: req.body?.floorEnforcement,
              floorPricePaisePerKg: req.body?.floorPricePaisePerKg,
            },
          });
        });
        res.status(200).json({ updated: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // Accountant: Generate Atomic Payout Batch (Phase A3: locks FISHERMAN_PAYABLE, builds items, posts PAYOUT_BATCH journal, rejects 0 balance)
  app.post(
    '/api/v1/payout-batches',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const result = await createPayoutBatch(req.db!, {
          tenantId,
          actorUserId: req.auth!.sub,
          actorRole: req.auth!.role,
          actorFullName: req.auth!.fullName,
        });
        invalidateLedgerAuditSqlLruCache(tenantId);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/v1/payout-batches/:batchId/reconcile',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const result = await reconcileSinglePayoutBatch(req.db!, {
          tenantId: req.auth!.tenantId,
          actorUserId: req.auth!.sub,
          actorRole: req.auth!.role,
          actorFullName: req.auth!.fullName,
          batchId: String(req.params.batchId ?? ''),
          rawBankUtr: req.body?.bankUtr,
          confirmTotalPaise: req.body?.confirmTotalPaise,
        });
        invalidateLedgerAuditSqlLruCache(req.auth!.tenantId);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/v1/payout-batches/bulk-reconcile',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const headerIdem =
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : null;
        const result = await executeRobustBulkUtrReconcile(req.db!, {
          tenantId: req.auth!.tenantId,
          actorUserId: req.auth!.sub,
          actorRole: req.auth!.role,
          actorFullName: req.auth!.fullName,
          rawBody: req.body as Record<string, unknown>,
          headerIdempotencyKey: headerIdem,
        });
        invalidateLedgerAuditSqlLruCache(req.auth!.tenantId);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Accountant: Record Buyer Settlement Receipt (Phase A3: posts BUYER_RECEIPT journal, decrements unsettled_payables_paise, rejects overpayment)
  app.post(
    '/api/v1/buyers/:buyerId/receipts',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const parsed = BuyerReceiptBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION_ERROR',
            parsed.error.issues[0]?.message ?? 'Invalid buyer receipt payload',
            400
          );
        }

        const rawIdem = req.headers['idempotency-key'];
        const idempotencyKey = String(
          (Array.isArray(rawIdem) ? rawIdem[0] : rawIdem) ?? ''
        ).trim();
        if (!idempotencyKey) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Idempotency-Key header is required for buyer receipts.',
            400
          );
        }

        const referenceNo = (
          parsed.data.referenceNo ??
          parsed.data.paymentReference ??
          'NODAL-RECEIPT'
        ).trim();

        const result = await recordBuyerReceipt(req.db!, {
          tenantId: req.auth!.tenantId,
          actorUserId: req.auth!.sub,
          actorRole: req.auth!.role,
          actorFullName: req.auth!.fullName,
          buyerId: String(req.params.buyerId ?? ''),
          amountPaise: BigInt(parsed.data.amountPaise),
          paymentChannel: parsed.data.paymentChannel,
          referenceNo,
          idempotencyKey,
        });

        invalidateLedgerAuditSqlLruCache(req.auth!.tenantId);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Dual-Key Reversal Execution (§7 Reversals)
  app.post(
    '/api/v1/ledger/reversals',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const action = String(req.body?.action ?? 'APPROVE');

        if (action === 'REQUEST') {
          const originalJournalId = String(req.body?.originalJournalId ?? '');
          const reasonNote = String(req.body?.reasonNote ?? '').trim();
          if (!originalJournalId || reasonNote.length < 5) {
            throw new AppError(
              'VALIDATION_ERROR',
              'originalJournalId and reasonNote (>= 5 chars) required',
              400
            );
          }
          const reversalId = `REV-REQ-${crypto.randomUUID()}`;
          const nowIso = new Date().toISOString();
          await req.db!.transaction(async (tx) => {
            await tx.query(
              `INSERT INTO ledger.reversal_requests (
                reversal_id, tenant_id, original_journal_id, reason_note,
                requested_by_user_id, requested_by_name, status, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_SECOND_APPROVAL', $7)`,
              [
                reversalId,
                tenantId,
                originalJournalId,
                reasonNote,
                req.auth!.sub,
                req.auth!.fullName,
                nowIso,
              ]
            );
            await auditInTx(tx, {
              tenantId,
              actorUserId: req.auth!.sub,
              actorRole: req.auth!.role,
              actionCode: 'REVERSAL_REQUESTED_KEY1',
              targetType: 'REVERSAL',
              targetId: reversalId,
              details: {
                actorName: req.auth!.fullName,
                originalJournalId,
                reasonNote,
              },
            });
          });
          res
            .status(201)
            .json({ reversalId, status: 'PENDING_SECOND_APPROVAL' });
          return;
        }

        const reversalId = String(req.body?.reversalId ?? '');
        const nowIso = new Date().toISOString();
        const result = await executeDualKeyReversal(req.db!, {
          tenantId,
          reversalId,
          approverUserId: req.auth!.sub,
          approverName: req.auth!.fullName,
          nowIso,
        });

        await req.db!.transaction((tx) =>
          auditInTx(tx, {
            tenantId,
            actorUserId: req.auth!.sub,
            actorRole: req.auth!.role,
            actionCode: 'DUAL_KEY_REVERSAL_EXECUTED',
            targetType: 'REVERSAL',
            targetId: reversalId,
            details: {
              actorName: req.auth!.fullName,
              compensatingJournalId: result.compensatingJournalId,
            },
          })
        );

        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Ledger SHA-256 Chain Verifier (Scoped to caller's tenant unless SUPER_ADMIN)
  app.get(
    '/api/v1/ledger/verify',
    requireAuth(['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const targetTenant =
          req.auth!.role === 'SUPER_ADMIN' && req.query.tenantId
            ? String(req.query.tenantId)
            : req.auth!.tenantId;
        const verification =
          req.auth!.role === 'SUPER_ADMIN'
            ? await withPlatform(db, (tx) => verifyTenantLedgerChain(tx, targetTenant))
            : await verifyTenantLedgerChain(req.db!, targetTenant);
        res.status(200).json(verification);
      } catch (err) {
        next(err);
      }
    }
  );

  // Platform Workspace: Provision New Tenant from Preset (<60s)
  app.post(
    '/api/v1/tenants',
    requireAuth(['SUPER_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const slug = String(req.body?.slug ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-');
        const nameEn = String(req.body?.nameEn ?? '').trim();
        const nameMl = String(req.body?.nameMl ?? nameEn).trim();
        const preset = String(
          req.body?.centreType ?? 'KERALA_HARBOUR'
        ) as CentreType;

        if (!slug || !nameEn) {
          throw new AppError(
            'VALIDATION_ERROR',
            'slug and nameEn are required',
            400
          );
        }

        const tenantId = `ten-${slug}`;
        const policyId = `POL-${slug.toUpperCase()}-V1`;
        const hmsAcc = `ACC-HMS-${slug}`;
        const coopAcc = `ACC-COOP-${slug}`;
        const revAcc = `ACC-REV-${slug}`;
        const gstAcc = `ACC-GST-${slug}`;

        const [auctBps, hmsBps, bonusBps, coopBps] =
          preset === 'KERALA_MARKET'
            ? [2000, 2000, 3000, 3000]
            : [2000, 2000, 4000, 2000];

        await withPlatform(db, async (tx) => {
          await tx.query(
            `INSERT INTO core.tenants (
              tenant_id, slug, name_en, name_ml, centre_type, floor_enforcement,
              active_policy_id, hms_account_id, coop_pool_account_id,
              harbouros_revenue_account_id, gst_payable_account_id
            ) VALUES ($1, $2, $3, $4, $5, 'WARN', $6, $7, $8, $9, $10)`,
            [
              tenantId,
              slug,
              nameEn,
              nameMl,
              preset,
              policyId,
              hmsAcc,
              coopAcc,
              revAcc,
              gstAcc,
            ]
          );

          await tx.query(
            `INSERT INTO core.commission_policies (
              policy_id, tenant_id, version_num, commercial_mode, commission_bps,
              auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
              notification_ref, legal_basis_ref, effective_from
            ) VALUES ($1, $2, 1, 'FIXED_SAAS_ONLY', 500, $3, $4, $5, $6, 'GO(P) No. 18/2021/F&PD', $7, $8)`,
            [
              policyId,
              tenantId,
              auctBps,
              hmsBps,
              bonusBps,
              coopBps,
              preset === 'KERALA_MARKET'
                ? ACT_16_2021_CITATIONS.MARKET_SPLIT_LABEL
                : ACT_16_2021_CITATIONS.HARBOUR_SPLIT_LABEL,
              new Date().toISOString().slice(0, 10),
            ]
          );

          await tx.query(
            `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
            [tenantId, GENESIS_PREV_HASH]
          );
        });

        res.status(201).json({ tenantId, slug, preset, policyId });
      } catch (err) {
        next(err);
      }
    }
  );

  // Platform / Harbour Workspace: Create Versioned Commission Policy (Enforces C7 Legal Sign-off Gate)
  app.post(
    '/api/v1/policies',
    requireAuth(['SUPER_ADMIN', 'HARBOUR_ADMIN']),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth!.tenantId;
        const commercialMode = String(
          req.body?.commercialMode ?? 'FIXED_SAAS_ONLY'
        ) as CommercialMode;
        const commissionBps = Number(req.body?.commissionBps ?? 500);
        const auctioneerShareBps = Number(req.body?.auctioneerShareBps ?? 2000);
        const hmsShareBps = Number(req.body?.hmsShareBps ?? 2000);
        const fisherBonusShareBps = Number(
          req.body?.fisherBonusShareBps ?? 4000
        );
        const coopShareBps = Number(req.body?.coopShareBps ?? 2000);
        const notificationRef = String(
          req.body?.notificationRef ?? 'GO(P) No. 18/2021/F&PD'
        );
        const legalSignoffRef = req.body?.legalSignoffRef
          ? String(req.body.legalSignoffRef).trim()
          : null;
        const legalSignoffDate = req.body?.legalSignoffDate
          ? String(req.body.legalSignoffDate).trim()
          : null;

        if (commissionBps < 0 || commissionBps > 500) {
          throw new AppError(
            'STATUTORY_CAP_BREACH',
            `Commission rate cannot exceed 500 bps (5.00%) under ${ACT_16_2021_CITATIONS.COMMISSION_CAP_500_BPS}`,
            422
          );
        }
        if (
          auctioneerShareBps +
            hmsShareBps +
            fisherBonusShareBps +
            coopShareBps !==
          10000
        ) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Recipient shares must sum to exactly 10,000 bps (100%)',
            422
          );
        }
        if (
          commercialMode !== 'FIXED_SAAS_ONLY' &&
          (!legalSignoffRef || !legalSignoffDate)
        ) {
          throw new AppError(
            'FORBIDDEN',
            `Commercial mode ${commercialMode} is blocked by statutory guardrail C7 (${ACT_16_2021_CITATIONS.COMMERCIAL_MODE_SIGNOFF_GATE}) unless both legalSignoffRef and legalSignoffDate are provided.`,
            422
          );
        }

        const nextVer = await req.db!.transaction(async (tx) => {
          const verRes = await tx.query<{ next_ver: number }>(
            `SELECT COALESCE(MAX(version_num), 0) + 1 AS next_ver FROM core.commission_policies WHERE tenant_id = $1`,
            [tenantId]
          );
          const ver = verRes.rows[0]?.next_ver ?? 2;
          const policyId = `POL-${tenantId.toUpperCase()}-V${ver}`;

          await tx.query(
            `INSERT INTO core.commission_policies (
              policy_id, tenant_id, version_num, commercial_mode, commission_bps,
              auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
              notification_ref, legal_basis_ref, legal_signoff_ref, legal_signoff_date, effective_from
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              policyId,
              tenantId,
              ver,
              commercialMode,
              commissionBps,
              auctioneerShareBps,
              hmsShareBps,
              fisherBonusShareBps,
              coopShareBps,
              notificationRef,
              ACT_16_2021_CITATIONS.POLICY_SPLIT_BASIS,
              legalSignoffRef,
              legalSignoffDate,
              new Date().toISOString().slice(0, 10),
            ]
          );

          await tx.query(
            `UPDATE core.tenants SET active_policy_id = $1 WHERE tenant_id = $2`,
            [policyId, tenantId]
          );

          return { ver, policyId };
        });

        res
          .status(201)
          .json({
            policyId: nextVer.policyId,
            versionNum: nextVer.ver,
            commercialMode,
          });
      } catch (err) {
        next(err);
      }
    }
  );

  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API route not found',
      },
    });
  });

  app.use(
    (err: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
        return;
      }

      logger.error('Unhandled API exception', {
        path: req.originalUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred.',
        },
      });
    }
  );

  return app;
}
