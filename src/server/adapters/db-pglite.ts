import { PGlite } from '@electric-sql/pglite';
import type { DbPort, DbQueryResult } from '@server/ports/db.ts';
import { executeWithStatementTimeout } from '@server/adapters/db-pg.ts';
import { DEFAULT_PG_STATEMENT_TIMEOUT_MS } from '@server/platform/observability.ts';

export class PGliteAdapter implements DbPort {
  private readonly pglite: PGlite;
  public readonly statementTimeoutMs: number;

  constructor(
    dataDir?: string,
    statementTimeoutMs = DEFAULT_PG_STATEMENT_TIMEOUT_MS
  ) {
    this.statementTimeoutMs = statementTimeoutMs;
    this.pglite = dataDir && dataDir !== 'memory://' ? new PGlite(dataDir) : new PGlite();
  }

  public async query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<DbQueryResult<T>> {
    return executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
      const res = await this.pglite.query<T>(sql, [...params]);
      return { rows: res.rows };
    });
  }

  public async exec(sql: string): Promise<void> {
    await executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
      await this.pglite.exec(sql);
    });
  }

  public async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    return this.pglite.transaction(async (pgTx) => {
      const txPort: DbPort = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown> = []
        ): Promise<DbQueryResult<R>> =>
          executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
            const res = await pgTx.query<R>(sql, [...params]);
            return { rows: res.rows };
          }),
        exec: async (sql: string): Promise<void> => {
          await executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
            await pgTx.exec(sql);
          });
        },
        transaction: async <R>(nestedFn: (nestedTx: DbPort) => Promise<R>): Promise<R> =>
          nestedFn(txPort),
      };
      return fn(txPort);
    });
  }

  public async close(): Promise<void> {
    await this.pglite.close();
  }
}
