import { PGlite } from '@electric-sql/pglite';
import type {
  DbPort,
  DbQueryResult,
  DbTransactionOptions,
} from '@server/ports/db.ts';
import { executeWithStatementTimeout } from '@server/adapters/db-pg.ts';
import { DEFAULT_PG_STATEMENT_TIMEOUT_MS } from '@server/platform/observability.ts';

export class PGliteAdapter implements DbPort {
  public readonly isPglite = true;
  private readonly pglite: PGlite;
  public readonly statementTimeoutMs: number;

  constructor(
    dataDir?: string,
    statementTimeoutMs = DEFAULT_PG_STATEMENT_TIMEOUT_MS
  ) {
    this.statementTimeoutMs = statementTimeoutMs;
    this.pglite =
      dataDir && dataDir !== 'memory://' ? new PGlite(dataDir) : new PGlite();
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

  public async transaction<T>(
    fn: (tx: DbPort) => Promise<T>,
    options?: DbTransactionOptions
  ): Promise<T> {
    const stats = options?.stats;
    const beginLabel = options?.readOnly
      ? 'BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ'
      : 'BEGIN';

    return this.pglite.transaction(async (pgTx) => {
      if (stats) {
        stats.roundTrips += 1;
        stats.statements.push(beginLabel);
      }

      const txPort: DbPort = {
        isPglite: true,
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown> = []
        ): Promise<DbQueryResult<R>> => {
          const startNs = process.hrtime.bigint();
          try {
            return await executeWithStatementTimeout(
              sql,
              this.statementTimeoutMs,
              async () => {
                const res = await pgTx.query<R>(sql, [...params]);
                return { rows: res.rows };
              }
            );
          } finally {
            if (stats) {
              stats.queries += 1;
              stats.roundTrips += 1;
              stats.dbMs +=
                Number(process.hrtime.bigint() - startNs) / 1_000_000;
              stats.statements.push(sql);
            }
          }
        },
        exec: async (sql: string): Promise<void> => {
          const startNs = process.hrtime.bigint();
          try {
            await executeWithStatementTimeout(
              sql,
              this.statementTimeoutMs,
              async () => {
                await pgTx.exec(sql);
              }
            );
          } finally {
            if (stats) {
              if (!sql.startsWith('SET LOCAL ROLE')) {
                stats.queries += 1;
                stats.roundTrips += 1;
                stats.statements.push(sql);
              }
              stats.dbMs +=
                Number(process.hrtime.bigint() - startNs) / 1_000_000;
            }
          }
        },
        transaction: async <R>(
          nestedFn: (nestedTx: DbPort) => Promise<R>
        ): Promise<R> => nestedFn(txPort),
      };

      const result = await fn(txPort);
      if (stats) {
        stats.roundTrips += 1;
        stats.statements.push('COMMIT');
      }
      return result;
    });
  }

  public async close(): Promise<void> {
    await this.pglite.close();
  }
}
