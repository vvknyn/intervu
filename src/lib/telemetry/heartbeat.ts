/**
 * Proof-of-life log for the telemetry-derived scheduled jobs: "a job that
 * cannot prove it ran is a job that is not running." `build-job-features`
 * and `roll-up-telemetry` each write exactly one row here via this same
 * function on every terminal state they reach IN-PROCESS — success or a
 * caught failure, including zero-row runs — so the upsert shape lives in
 * one place instead of being copy-pasted into each script. That
 * "in-process" qualifier is load-bearing: every call site is a
 * try(ok=true)/catch(ok=false) pair, so a run killed by SIGKILL, an OOM
 * kill, the job timeout, or a box reboot writes nothing here at all. A
 * missing or stale row is therefore equally consistent with "never
 * started", "running right now", and "killed mid-run" — it does NOT mean
 * the job has never run. (Mirrors the fix made to the subspace repo's
 * telemetry.job_freshness_h check, commit 10dd9a23.)
 *
 * `intervu.job_heartbeats` (job_name text primary key, last_run_at,
 * rows_affected, ok) is owned by deploy/db-box/telemetry-schema.sql, one row
 * per job_name. `scripts/reap-telemetry.ts` (its cron-batching alternative
 * to the box's own `reap_telemetry()` plpgsql function) upserts the same
 * shape and imports this function rather than carrying its own inline copy
 * — one writer of this statement across all three scheduled scripts, not
 * three copies that could drift.
 *
 * `Queryable` (src/lib/pg/pool.ts) is reused rather than inventing a second
 * DB-access interface: a raw `pg.Client`/`pg.Pool` already satisfies it
 * structurally (`.query(text, params)` resolving to `{ rows }`), which is
 * what these standalone scripts connect with.
 */
import type { Queryable } from "@/lib/pg/pool";

export async function writeHeartbeat(
  db: Queryable,
  jobName: string,
  rowsAffected: number,
  ok: boolean,
): Promise<void> {
  await db.query(
    `insert into intervu.job_heartbeats (job_name, last_run_at, rows_affected, ok)
     values ($1, now(), $2, $3)
     on conflict (job_name) do update
       set last_run_at   = excluded.last_run_at,
           rows_affected = excluded.rows_affected,
           ok            = excluded.ok`,
    [jobName, rowsAffected, ok],
  );
}
