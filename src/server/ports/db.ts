import crypto from 'node:crypto';
import { AppError } from '@server/platform/errors.ts';

export interface DbQueryResult<T = Record<string, unknown>> {
  readonly rows: ReadonlyArray<T>;
}

export interface DbTransactionOptions {
  readonly readOnly?: boolean | undefined;
  readonly stats?: DbRequestStats | undefined;
}

export interface DbRequestStats {
  queries: number;
  roundTrips: number;
  dbMs: number;
  statements: string[];
}

export function createDbRequestStats(): DbRequestStats {
  return {
    queries: 0,
    roundTrips: 0,
    dbMs: 0,
    statements: [],
  };
}

export interface DbPort {
  readonly isPglite?: boolean | undefined;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>
  ): Promise<DbQueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(
    fn: (tx: DbPort) => Promise<T>,
    options?: DbTransactionOptions
  ): Promise<T>;
  close?(): Promise<void>;
}

/**
 * Executes a tenant-scoped database unit of work inside a single transaction.
 * On real PostgreSQL, the connection pool is already `harbour_app` (NOBYPASSRLS),
 * so only `SELECT set_config('app.tenant_id', $1, true)` is issued once per transaction.
 * On PGlite (single-user in-memory), `SET LOCAL ROLE harbour_app` is issued first.
 */
export async function withTenant<T>(
  db: DbPort,
  tenantId: string,
  fn: (tx: DbPort) => Promise<T>,
  options?: DbTransactionOptions
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('withTenant requires a non-empty tenantId');
  }
  return db.transaction(async (tx) => {
    if (db.isPglite) {
      await tx.exec(`SET LOCAL ROLE harbour_app`);
    }
    const startNs = process.hrtime.bigint();
    await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    if (options?.stats) {
      options.stats.queries = Math.max(0, options.stats.queries - 1);
      const elapsed = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      options.stats.dbMs = Math.max(0, options.stats.dbMs);
      void elapsed;
    }
    return fn(tx);
  }, options);
}

/**
 * Executes a platform-scoped database unit of work inside a transaction as
 * role `harbour_platform` (BYPASSRLS) with empty tenant context.
 */
export async function withPlatform<T>(
  db: DbPort,
  fn: (tx: DbPort) => Promise<T>,
  options?: DbTransactionOptions
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('app.tenant_id', '', true)`);
    if (options?.stats) {
      options.stats.queries = Math.max(0, options.stats.queries - 1);
    }
    return fn(tx);
  }, options);
}

/**
 * Runs a request handler with a LAZY per-request transaction (Phase 2.1)
 */
export async function runWithLazyTenantDb<T>(
  baseDb: DbPort,
  tenantId: string,
  options: { readOnly: boolean; stats: DbRequestStats },
  handler: (lazyDb: DbPort) => Promise<T>
): Promise<T> {
  let activeTxPromise: Promise<DbPort> | null = null;
  let finishTx: (() => void) | null = null;
  let failTx: ((err: unknown) => void) | null = null;
  const txRef: { completion: Promise<void> | null } = { completion: null };

  const ensureTx = (): Promise<DbPort> => {
    if (activeTxPromise) {
      return activeTxPromise;
    }
    activeTxPromise = new Promise<DbPort>((resolveTx, rejectTx) => {
      txRef.completion = withTenant(
        baseDb,
        tenantId,
        async (tx) => {
          await new Promise<void>((resDone, rejDone) => {
            finishTx = resDone;
            failTx = rejDone;
            resolveTx(tx);
          });
        },
        { readOnly: options.readOnly, stats: options.stats }
      ).catch((err: unknown) => {
        rejectTx(err);
        throw err;
      });
    });
    return activeTxPromise;
  };

  const lazyDb: DbPort = {
    isPglite: baseDb.isPglite,
    query: async <R = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>
    ): Promise<DbQueryResult<R>> => {
      const tx = await ensureTx();
      return tx.query<R>(sql, params);
    },
    exec: async (sql: string): Promise<void> => {
      const tx = await ensureTx();
      return tx.exec(sql);
    },
    transaction: async <R>(fn: (tx: DbPort) => Promise<R>): Promise<R> => {
      const tx = await ensureTx();
      return fn(tx);
    },
  };

  try {
    const result = await handler(lazyDb);
    if (finishTx && txRef.completion) {
      (finishTx as () => void)();
      await txRef.completion;
    }
    return result;
  } catch (err) {
    if (failTx && txRef.completion) {
      (failTx as (e: unknown) => void)(err);
      await txRef.completion.catch(() => undefined);
    }
    throw err;
  }
}

export function createTenantBoundDb(
  baseDb: DbPort,
  tenantId: string,
  stats?: DbRequestStats
): DbPort {
  return {
    isPglite: baseDb.isPglite,
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>
    ): Promise<DbQueryResult<T>> =>
      withTenant(baseDb, tenantId, (tx) => tx.query<T>(sql, params), { stats }),
    exec: (sql: string): Promise<void> =>
      withTenant(baseDb, tenantId, (tx) => tx.exec(sql), { stats }),
    transaction: <T>(
      fn: (tx: DbPort) => Promise<T>,
      options?: DbTransactionOptions
    ): Promise<T> =>
      withTenant(baseDb, tenantId, fn, {
        readOnly: options?.readOnly,
        stats: options?.stats ?? stats,
      }),
  };
}

export function createPlatformBoundDb(baseDb: DbPort): DbPort {
  return {
    isPglite: baseDb.isPglite,
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>
    ): Promise<DbQueryResult<T>> =>
      withPlatform(baseDb, (tx) => tx.query<T>(sql, params)),
    exec: (sql: string): Promise<void> =>
      withPlatform(baseDb, (tx) => tx.exec(sql)),
    transaction: <T>(
      fn: (tx: DbPort) => Promise<T>,
      options?: DbTransactionOptions
    ): Promise<T> => withPlatform(baseDb, fn, options),
  };
}

/**
 * Phase 2.7: Retries transient PostgreSQL deadlock (`40P01`) or serialization failure (`40001`)
 * up to `maxRetries` (default 3) times with CSPRNG jitter, then converts to HTTP 409 CONFLICT.
 */
export async function withRetry<T>(
  work: (attempt: number) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await work(attempt);
    } catch (err: unknown) {
      const pgCode = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        pgCode === '40P01' ||
        pgCode === '40001' ||
        /deadlock detected|could not serialize access/i.test(msg);

      if (!isRetryable) {
        throw err;
      }
      if (attempt >= maxRetries) {
        throw new AppError(
          'CONFLICT',
          'Concurrent transaction conflict after maximum retries; please retry.',
          409
        );
      }
      const jitterMs = crypto.randomInt(8, 35) * (attempt + 1);
      await new Promise<void>((resolve) => setTimeout(resolve, jitterMs));
    }
  }
  throw new AppError('CONFLICT', 'Concurrent transaction conflict', 409);
}

/**
 * Inserts an immutable audit record inside the caller's active database transaction
 * using a CSPRNG UUID (`crypto.randomUUID()`) and database timestamp (`now()::text`).
 */
export async function auditInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actionCode: string;
    targetType: string;
    targetId: string;
    details: Record<string, unknown>;
    auditId?: string;
  }
): Promise<string> {
  const auditId = params.auditId ?? `AUD-${crypto.randomUUID()}`;
  await tx.query(
    `INSERT INTO core.audit_logs (
      audit_id, tenant_id, actor_user_id, actor_role, action_code,
      target_type, target_id, details_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()::text)`,
    [
      auditId,
      params.tenantId,
      params.actorUserId,
      params.actorRole,
      params.actionCode,
      params.targetType,
      params.targetId,
      JSON.stringify(params.details),
    ]
  );
  return auditId;
}
