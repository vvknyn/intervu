/**
 * Proof-of-life log for the telemetry-derived scheduled jobs: "a job that
 * cannot prove it ran is a job that is not running." `build-job-features`
 * and `roll-up-telemetry` each write exactly one row here via this same
 * function on every terminal state they reach IN-PROCESS — success or a
 * caught failure, including zero-row runs — so the upsert shape lives in
 * one place instead of being copy-pasted into each script.
 *
 * That "in-process" qualifier used to be a real hole: every call site is a
 * try(ok=true)/catch(ok=false) pair, so a run killed by SIGKILL, an OOM
 * kill, or the job timeout never reaches either branch and writes nothing
 * here at all — "never started" and "killed mid-run" looked identical.
 * Fixed 2026-09-04: `deploy/run-telemetry-job.sh` is the supervisor that
 * runs every job under a timeout and is the one process that survives a
 * child's death, so on any non-zero child exit it calls this same function
 * itself (via `scripts/record-job-failure.ts`) with the `onlyIfOlderThanSeconds`
 * guard below. A missing or stale row now means only one thing — the job
 * has not completed a run since that timestamp — never "or it might be
 * running right now with no way to tell." (Mirrors the fix made to the
 * subspace repo's telemetry.job_freshness_h check, commit 10dd9a23.)
 *
 * The guard takes a DURATION (elapsed seconds), never an absolute
 * timestamp. `now()` on line 60 below is evaluated on the DB box; the
 * supervisor's wall clock is on the app box. Comparing `last_run_at`
 * against an absolute timestamp computed by the app box would make the
 * guard's correctness depend on the two boxes' clocks agreeing — a
 * duration measured entirely on the app box's own clock carries no skew,
 * and `now() - make_interval(...)` lets the DB derive the threshold on its
 * own clock, compared against a value also stamped by that same clock.
 *
 * `intervu.job_heartbeats` (job_name text primary key, last_run_at,
 * rows_affected, ok) is owned by deploy/db-box/telemetry-schema.sql, one row
 * per job_name. `scripts/reap-telemetry.ts` (its cron-batching alternative
 * to the box's own `reap_telemetry()` plpgsql function) upserts the same
 * shape and imports this function rather than carrying its own inline copy
 * — one writer of this statement across every job and the supervisor, not
 * a copy per caller that could drift.
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
  rowsAffected: number | null,
  ok: boolean,
  /**
   * When set, the write is skipped unless the row's current `last_run_at`
   * predates (now() - this many seconds), both sides evaluated on the DB's
   * own clock. This is how the supervisor's failure write
   * (scripts/record-job-failure.ts) avoids clobbering a row the job already
   * wrote for THIS run: pass the run's elapsed wall-clock seconds (a
   * duration, measured entirely on the app box, so it carries no skew
   * between the two boxes' clocks), and a child that reached its own
   * try/catch mid-run always wins because its `last_run_at` is newer than
   * the DB's own now()-minus-elapsed estimate of when the run started.
   */
  guard?: { onlyIfOlderThanSeconds: number },
): Promise<void> {
  const params: unknown[] = [jobName, rowsAffected, ok];
  let where = "";
  if (guard) {
    params.push(guard.onlyIfOlderThanSeconds);
    where = ` where intervu.job_heartbeats.last_run_at < now() - make_interval(secs => $${params.length})`;
  }
  await db.query(
    `insert into intervu.job_heartbeats (job_name, last_run_at, rows_affected, ok)
     values ($1, now(), $2, $3)
     on conflict (job_name) do update
       set last_run_at   = excluded.last_run_at,
           rows_affected = excluded.rows_affected,
           ok            = excluded.ok${where}`,
    params,
  );
}
