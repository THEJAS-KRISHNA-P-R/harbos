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
 * Executes a tenant-scoped database unit of work inside a transaction with
 * PostgreSQL Row-Level Security (`app.rls_strict = 'on'`) and `app.tenant_id` bound.
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
    await tx.query(
      `SELECT set_config('app.rls_strict', 'on', true), set_config('app.tenant_id', $1, true)`,
      [tenantId]
    );
    return fn(tx);
  });
}
