import pg from 'pg';
import { config } from '@server/config.ts';
import type {
  DbPort,
  DbQueryResult,
  DbTransactionOptions,
} from '@server/ports/db.ts';
import {
  DEFAULT_PG_STATEMENT_TIMEOUT_MS,
  recordCentralizedLog,
  recordQueryExecution,
} from '@server/platform/observability.ts';

const { Pool } = pg;

export async function executeWithStatementTimeout<T>(
  sql: string,
  statementTimeoutMs: number,
  work: () => Promise<T>
): Promise<T> {
  const startNs = process.hrtime.bigint();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Query exceeded global statement_timeout of ${statementTimeoutMs}ms`
          )
        );
      }, statementTimeoutMs);
    });
    const res = await Promise.race([work(), timeoutPromise]);
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    recordQueryExecution({ sql, durationMs, timedOut: false });
    return res;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut =
      msg.includes('statement_timeout') || msg.includes('statement timeout');
    recordQueryExecution({ sql, durationMs, timedOut, error: msg });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class PgPoolAdapter implements DbPort {
  public readonly isPglite = false;
  private readonly pool: pg.Pool;
  public readonly statementTimeoutMs: number;

  constructor(
    connectionString: string,
    statementTimeoutMs = DEFAULT_PG_STATEMENT_TIMEOUT_MS,
    poolMax = config.PG_POOL_MAX
  ) {
    this.statementTimeoutMs = statementTimeoutMs;
    // Phase 2.8: Zero startup GUC options on Pool so PgBouncer in transaction mode works cleanly.
    // Timeouts are enforced on role `harbour_app` / `harbour_platform` via migration 012.
    this.pool = new Pool({
      connectionString,
      max: poolMax,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    });

    this.pool.on('error', (err) => {
      recordCentralizedLog({
        level: 'error',
        service: 'db-pg-pool',
        actionCode: 'PG_POOL_IDLE_CLIENT_ERROR',
        message: `Unexpected error on idle PostgreSQL pool client: ${err.message}`,
      });
    });
  }

  public async query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<DbQueryResult<T>> {
    return executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
      const res = await this.pool.query(sql, [...params]);
      return { rows: res.rows as T[] };
    });
  }

  public async exec(sql: string): Promise<void> {
    await executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
      await this.pool.query(sql);
    });
  }

  public async transaction<T>(
    fn: (tx: DbPort) => Promise<T>,
    options?: DbTransactionOptions
  ): Promise<T> {
    const client = await this.pool.connect();
    const stats = options?.stats;
    const beginSql = options?.readOnly
      ? 'BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ'
      : 'BEGIN';

    let txChain: Promise<unknown> = Promise.resolve();
    const enqueue = <R>(work: () => Promise<R>): Promise<R> => {
      const next = txChain.then(work, work);
      txChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    };

    const runTracked = async <R>(
      stmtLabel: string,
      isAppQuery: boolean,
      work: () => Promise<R>
    ): Promise<R> => {
      const startNs = process.hrtime.bigint();
      try {
        return await work();
      } finally {
        if (stats) {
          const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
          stats.roundTrips += 1;
          stats.dbMs += ms;
          stats.statements.push(stmtLabel);
          if (isAppQuery) {
            stats.queries += 1;
          }
        }
      }
    };

    try {
      await enqueue(() =>
        runTracked(beginSql, false, () => client.query(beginSql))
      );

      const txPort: DbPort = {
        isPglite: false,
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown> = []
        ): Promise<DbQueryResult<R>> =>
          enqueue(() =>
            runTracked(sql, true, () =>
              executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
                const res = await client.query(sql, [...params]);
                return { rows: res.rows as R[] };
              })
            )
          ),
        exec: async (sql: string): Promise<void> => {
          await enqueue(() =>
            runTracked(sql, true, () =>
              executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
                await client.query(sql);
              })
            )
          );
        },
        transaction: async <R>(
          nestedFn: (nestedTx: DbPort) => Promise<R>
        ): Promise<R> => nestedFn(txPort),
      };

      const result = await fn(txPort);
      await enqueue(() =>
        runTracked('COMMIT', false, () => client.query('COMMIT'))
      );
      return result;
    } catch (err) {
      await enqueue(() =>
        runTracked('ROLLBACK', false, () => client.query('ROLLBACK'))
      ).catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
