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
 * `pool`/`initialized` pair, so every accessor built from this factory gets
 * its own `Pool` instance and connection lifecycle — that isolation is what
 * `getIntervuPg` (identity store) and `getExhaustPg` (box PG) need.
 *
 * Two accessors CAN share a connection string and role on purpose and still
 * never share a pool: `getTelemetryPg`/`getTelemetryForgetPg` both read
 * TELEMETRY_PG_URL — same URL, same role — precisely so each keeps its own
 * statement-timeout budget (5s ingest vs 30s erasure) without one
 * workload's pool exhaustion or timeout starving the other's connections.
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

/**
 * Returns the telemetry-ledger INGEST seam, or null when TELEMETRY_PG_URL is
 * unset — the same fail-soft-on-missing-env contract as `getIntervuPg`/
 * `getExhaustPg`/`getAgentPg`. This pool only ever INSERTs: the
 * `telemetry_pg` role has no select/update/delete grant at all
 * (`deploy/db-box/telemetry-schema.sql` §4). Tight 5s statement timeout —
 * this backs `POST /api/telemetry`, which must never let a slow write hold
 * up the request; telemetry failing must never break a page.
 */
export const getTelemetryPg = createPool("TELEMETRY_PG_URL", { statementTimeout: "5s" });

/**
 * The ERASURE seam onto the same ledger, on the SAME credential — a second
 * pool, deliberately not a second role.
 *
 * `forgetIdentity` has to delete a user's ledger rows, and the two obvious
 * ways to let it are both worse than they look. Widening `telemetry_pg` to
 * DELETE hands the internet-facing ingest credential an unconstrained
 * `DELETE FROM telemetry_events` — a whole-ledger-wipe primitive on the most
 * attackable surface this app has. Handing the web app `BATCH_PG_URL` is
 * worse still: that is `pipeline`, the role that owns every table in the
 * schema.
 *
 * So the delete goes through `intervu.forget_telemetry_user(text)`, a
 * SECURITY DEFINER function owned by the table owner (telemetry-schema.sql
 * §7). The capability granted is "erase the rows belonging to one user id",
 * never "delete rows", and the role still cannot SELECT a single query
 * string, job id or props blob — even fully compromised it reads nothing.
 *
 * It is a separate POOL only because the latency contracts differ: ingest
 * gets 5s because a slow write must not hold up a page; erasure is a rare,
 * deliberate, user-initiated action over an unbounded row count, so it gets
 * 30s. Same URL, same role, different budget.
 */
export const getTelemetryForgetPg = createPool("TELEMETRY_PG_URL", { statementTimeout: "30s" });

export function isIdentityStoreEnabled(): boolean {
  return getIntervuPg() !== null;
}
