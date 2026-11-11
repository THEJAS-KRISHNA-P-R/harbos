import pg from 'pg';
import type { DbPort, DbQueryResult } from '@server/ports/db.ts';
import {
  DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS,
  DEFAULT_PG_LOCK_TIMEOUT_MS,
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
  private readonly pool: pg.Pool;
  public readonly statementTimeoutMs: number;

  constructor(
    connectionString: string,
    statementTimeoutMs = DEFAULT_PG_STATEMENT_TIMEOUT_MS
  ) {
    this.statementTimeoutMs = statementTimeoutMs;
    this.pool = new Pool({
      connectionString,
      max: 20,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: this.statementTimeoutMs,
      query_timeout: this.statementTimeoutMs,
      lock_timeout: DEFAULT_PG_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS,
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

  public async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let txChain: Promise<unknown> = Promise.resolve();
    const enqueue = <R>(work: () => Promise<R>): Promise<R> => {
      const next = txChain.then(work, work);
      txChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    };

    try {
      await enqueue(() =>
        client.query(`BEGIN; SET LOCAL statement_timeout = ${this.statementTimeoutMs};`)
      );
      const txPort: DbPort = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown> = []
        ): Promise<DbQueryResult<R>> =>
          enqueue(() =>
            executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
              const res = await client.query(sql, [...params]);
              return { rows: res.rows as R[] };
            })
          ),
        exec: async (sql: string): Promise<void> => {
          await enqueue(() =>
            executeWithStatementTimeout(sql, this.statementTimeoutMs, async () => {
              await client.query(sql);
            })
          );
        },
        transaction: async <R>(nestedFn: (nestedTx: DbPort) => Promise<R>): Promise<R> =>
          nestedFn(txPort),
      };
      const result = await fn(txPort);
      await enqueue(() => client.query('COMMIT'));
      return result;
    } catch (err) {
      await enqueue(() => client.query('ROLLBACK')).catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
