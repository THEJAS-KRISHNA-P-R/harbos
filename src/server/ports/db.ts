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
}
