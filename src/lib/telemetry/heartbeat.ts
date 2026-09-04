/**
 * Proof-of-life log for the telemetry-derived scheduled jobs — SPEC.md §7:
 * "a job that cannot prove it ran is a job that is not running." Every run
 * of `build-job-features` and `roll-up-telemetry` writes exactly one row
 * here via this same function, including zero-row runs, so the upsert
 * shape lives in one place instead of being copy-pasted into each script.
 *
 * `intervu.job_heartbeats` (job_name text primary key, last_run_at,
 * rows_affected, ok) is owned by deploy/db-box/telemetry-schema.sql, one row
 * per job_name — this mirrors that file's own `reap_telemetry()`, which
 * upserts its heartbeat on conflict (job_name) rather than appending, so
 * this is the second (not third) writer of the same shape, not a
 * competing one.
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
