import crypto from 'node:crypto';

export interface DbQueryResult<T = Record<string, unknown>> {
  readonly rows: ReadonlyArray<T>;
}

export interface DbPort {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>
  ): Promise<DbQueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

/**
 * Executes a tenant-scoped database unit of work inside a transaction as
 * least-privilege role `harbour_app` (NOBYPASSRLS) with `app.tenant_id` bound.
 */
export async function withTenant<T>(
  db: DbPort,
  tenantId: string,
  fn: (tx: DbPort) => Promise<T>
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('withTenant requires a non-empty tenantId');
  }
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE harbour_app`);
    await tx.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [tenantId]
    );
    return fn(tx);
  });
}

/**
 * Executes a platform-scoped database unit of work inside a transaction as
 * role `harbour_platform` (BYPASSRLS) with empty tenant context.
 */
export async function withPlatform<T>(
  db: DbPort,
  fn: (tx: DbPort) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(
      `SELECT set_config('app.tenant_id', '', true)`
    );
    return fn(tx);
  });
}

export function createTenantBoundDb(baseDb: DbPort, tenantId: string): DbPort {
  return {
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>
    ): Promise<DbQueryResult<T>> =>
      withTenant(baseDb, tenantId, (tx) => tx.query<T>(sql, params)),
    exec: (sql: string): Promise<void> =>
      withTenant(baseDb, tenantId, (tx) => tx.exec(sql)),
    transaction: <T>(fn: (tx: DbPort) => Promise<T>): Promise<T> =>
      withTenant(baseDb, tenantId, fn),
  };
}

export function createPlatformBoundDb(baseDb: DbPort): DbPort {
  return {
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>
    ): Promise<DbQueryResult<T>> =>
      withPlatform(baseDb, (tx) => tx.query<T>(sql, params)),
    exec: (sql: string): Promise<void> =>
      withPlatform(baseDb, (tx) => tx.exec(sql)),
    transaction: <T>(fn: (tx: DbPort) => Promise<T>): Promise<T> =>
      withPlatform(baseDb, fn),
  };
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
