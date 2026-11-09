import pg from 'pg';
import type { DbPort, DbQueryResult } from '@server/ports/db.ts';

const { Pool } = pg;

export class PgPoolAdapter implements DbPort {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 15_000,
    });
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL pool client:', err);
    });
  }

  public async query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = []
  ): Promise<DbQueryResult<T>> {
    const res = await this.pool.query(sql, [...params]);
    return { rows: res.rows as T[] };
  }

  public async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  public async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txPort: DbPort = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown> = []
        ): Promise<DbQueryResult<R>> => {
          const res = await client.query(sql, [...params]);
          return { rows: res.rows as R[] };
        },
        exec: async (sql: string): Promise<void> => {
          await client.query(sql);
        },
        transaction: async <R>(nestedFn: (nestedTx: DbPort) => Promise<R>): Promise<R> =>
          nestedFn(txPort),
      };
      const result = await fn(txPort);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
