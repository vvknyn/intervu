import { Pool } from "pg";

/**
 * Thin seam over a Postgres instance. Every statement runs inside a
 * transaction that opens with `SET LOCAL statement_timeout` (and, for
 * read-only seams, `SET LOCAL default_transaction_read_only`) so both bind
 * to the transaction's own backend rather than whichever connection a
 * pooler hands back next (a bare `SET` binds to one pooled backend and can
 * leak past the statement it was meant to guard).
 */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

interface PoolOptions {
  /** SET LOCAL default_transaction_read_only = on for every statement. */
  readOnly?: boolean;
  /** e.g. "15s" — passed verbatim to SET LOCAL statement_timeout. */
  statementTimeout: string;
}

class TransactionQueryable implements Queryable {
  constructor(
    private readonly pool: Pool,
    private readonly options: PoolOptions,
  ) {}

  async query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '${this.options.statementTimeout}'`);
      if (this.options.readOnly) {
        await client.query("SET LOCAL default_transaction_read_only = on");
      }
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

/**
 * Builds a lazily-initialized, fail-soft accessor for one env-configured
 * Postgres instance. Each call to `createPool` closes over its own
 * `pool`/`initialized` pair, so two accessors built from this factory never
 * share a connection pool or a connection string — the isolation
 * `getIntervuPg` (identity store) and `getExhaustPg` (box PG) both need.
 */
function createPool(envVar: string, options: PoolOptions): () => Queryable | null {
  let queryable: Queryable | null = null;
  let initialized = false;

  return function getPg(): Queryable | null {
    if (initialized) return queryable;
    initialized = true;
    const connectionString = process.env[envVar];
    if (!connectionString) return null;
    const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
    queryable = new TransactionQueryable(pool, options);
    return queryable;
  };
}

/** Returns the identity-store query seam, or null when INTERVU_PG_URL is unset. Never throws. */
export const getIntervuPg = createPool("INTERVU_PG_URL", { statementTimeout: "15s" });

/**
 * Returns the box-PG (pipeline exhaust) query seam, or null when
 * EXHAUST_PG_URL is unset — the same fail-soft-on-missing-env contract as
 * `getIntervuPg`. Read-only (`default_transaction_read_only=on`) and a
 * tight 5s statement timeout: this pool serves company-page reads, never
 * writes, and must never let a slow box query hold up a page render.
 */
export const getExhaustPg = createPool("EXHAUST_PG_URL", { readOnly: true, statementTimeout: "5s" });

/**
 * Returns the agent/MCP credential-store query seam, or null when
 * AGENT_PG_URL is unset — the same fail-soft-on-missing-env contract as
 * `getIntervuPg`/`getExhaustPg`. Read-write (unlike `getExhaustPg`): this
 * pool backs `postgresStore()` (lib/agent/store.ts), which issues, verifies,
 * and revokes MCP bearer credentials.
 */
export const getAgentPg = createPool("AGENT_PG_URL", { statementTimeout: "15s" });

export function isIdentityStoreEnabled(): boolean {
  return getIntervuPg() !== null;
}
