import { Pool } from "pg";

/**
 * Thin seam over the intervu identity Postgres instance. Every statement
 * runs inside a transaction that opens with `SET LOCAL statement_timeout`
 * so the timeout binds to the transaction's own backend rather than
 * whichever connection a pooler hands back next (bare `SET` binds to one
 * pooled backend and can leak past the statement it was meant to guard).
 */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

const STATEMENT_TIMEOUT = "15s";

class TransactionQueryable implements Queryable {
  constructor(private readonly pool: Pool) {}

  async query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const result = await client.query(text, params as unknown[]);
      await client.query("COMMIT");
      return { rows: result.rows as R[] };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

let queryable: Queryable | null = null;
let queryableInitialized = false;

/** Returns the identity-store query seam, or null when INTERVU_PG_URL is unset. Never throws. */
export function getIntervuPg(): Queryable | null {
  if (queryableInitialized) return queryable;
  queryableInitialized = true;
  const connectionString = process.env.INTERVU_PG_URL;
  if (!connectionString) return null;
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  queryable = new TransactionQueryable(pool);
  return queryable;
}

export function isIdentityStoreEnabled(): boolean {
  return getIntervuPg() !== null;
}
