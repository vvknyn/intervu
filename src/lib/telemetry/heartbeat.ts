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
 * itself (via `scripts/record-job-failure.ts`) with the `onlyIfNotFromRun`
 * guard below. A missing or stale row now means only one thing — the job
 * has not completed a run since that timestamp — never "or it might be
 * running right now with no way to tell." (Mirrors the fix made to the
 * subspace repo's telemetry.job_freshness_h check, commit 10dd9a23.)
 *
 * THE GUARD, AND WHY IT COMPARES IDENTITY, NOT TIME (fixed 2026-09-04): the
 * guard used to be a DURATION — `onlyIfOlderThanSeconds`, compared as
 * `last_run_at < now() - make_interval(secs => $elapsed)` — reasoning that a
 * child's own write is always "newer" than the supervisor's now()-minus-
 * elapsed estimate of when the run started. That reasoning depended on
 * `elapsed` being a positive, non-trivial number of whole seconds. Measured
 * on PG 18.3: a child that writes its own failure row and exits within the
 * same wall-clock second the supervisor reads for `$(date +%s)` produces
 * elapsed=0, and `now() - make_interval(secs => 0)` is just `now()` —
 * `last_run_at < now()` is true for a row written microseconds ago, so the
 * supervisor's guard "passed" and destroyed the child's real rows_affected
 * with its own `null`. This is not a corner case: it is the modal path,
 * because build-job-features.ts's own catch block writes its row and
 * rethrows in the same statement, so the supervisor fires within
 * milliseconds of the child's write on every ordinary failure. `elapsed` was
 * never actually answering "is this row from this run?" — it was a proxy
 * for that question, built from a wall clock that cannot see run identity,
 * and every failure mode above is that proxy diverging from the property it
 * stood in for.
 *
 * The fix replaces the proxy with the property itself: every write now
 * carries a `run_id` (see the `runId` parameter below), and the guard
 * compares `run_id` instead of a clock reading —
 * `where intervu.job_heartbeats.run_id is distinct from $n`. This makes
 * four cases exact where the duration guard only handled some of them by
 * accident:
 *
 *   1. No prior row, and the run's own job never wrote one before dying ->
 *      the upsert's INSERT branch runs (there is no conflict) -> plain
 *      insert, unconditionally, guard clause never evaluated.
 *   2. No prior row for this job, but the run's own job DID reach its own
 *      try/catch and write a row for this exact run before the supervisor's
 *      write executes -> the supervisor's write now conflicts on
 *      `job_name`; `run_id is distinct from $n` compares the row the child
 *      just wrote against the supervisor's own run id, which are the SAME
 *      run's id -> false -> the WHERE fails -> the UPDATE declines, and the
 *      child's richer row (real rows_affected) survives untouched.
 *   3. A prior row exists from an OLDER run, or (rows written before this
 *      column existed) with `run_id is null` — either way the run's own job
 *      wrote nothing this time -> `run_id is distinct from $n` is true
 *      (`null is distinct from` anything non-null is also true) -> the
 *      WHERE passes -> the UPDATE applies, replacing the stale row with
 *      this run's terminal state.
 *   4. A prior row already carries THIS run's id — e.g. a retried
 *      supervisor write, or the same run's own job having already written
 *      it — the same identity comparison as case 2 -> declines. Writing the
 *      same run's row twice is a no-op, never a clobber, regardless of
 *      which caller got there first.
 *
 * None of this depends on either box's wall clock, or on how close together
 * two writes land in real time — it depends only on whether two writes
 * share a run id, which either process can determine before either of them
 * has touched the database.
 *
 * `intervu.job_heartbeats` (job_name text primary key, last_run_at,
 * rows_affected, ok, run_id) is owned by deploy/db-box/telemetry-schema.sql,
 * one row per job_name. `scripts/reap-telemetry.ts` (its cron-batching
 * alternative to the box's own `reap_telemetry()` plpgsql function) upserts
 * the same shape and imports this function rather than carrying its own
 * inline copy.
 *
 * This is NOT the only writer of this row shape, though — correcting a
 * claim this doc used to make. `deploy/db-box/telemetry-schema.sql`'s
 * `reap_telemetry()` plpgsql function contains a second, entirely unguarded
 * `insert ... on conflict (job_name) do update` on this same table (around
 * its own `insert into intervu.job_heartbeats` statement). That copy is not
 * a bug to fix here: it runs inside Postgres itself, is not supervised by
 * `deploy/run-telemetry-job.sh`, and has no concurrent writer racing it for
 * the same job_name, so it has nothing to guard against. It does mean this
 * function is the one writer for every JOB SUPERVISED BY THE WRAPPER, not
 * literally every writer of this table.
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
   * When set, the write is skipped unless the row's current `run_id` is
   * distinct from `onlyIfNotFromRun` (NULL and any other run id both count
   * as distinct). This is how the supervisor's failure write
   * (scripts/record-job-failure.ts) avoids clobbering a row the job already
   * wrote for THIS run: pass the run's own id, and a row already carrying
   * that id — written by either the job itself or a previous attempt at
   * this same write — is left alone.
   *
   * An empty string is rejected rather than silently accepted: `run_id is
   * distinct from ''` is true for every row with a NULL or non-empty
   * run_id, which is every row that predates this column and most rows
   * since, so an empty-string guard would evaluate as "always update" —
   * indistinguishable from no guard at all, but signed by a value that
   * looks like it should be doing something.
   */
  guard?: { onlyIfNotFromRun: string },
  /**
   * The run identity to stamp on this write. Defaults (when omitted, i.e.
   * `undefined`) to `process.env.INTERVU_RUN_ID` — every job script runs as
   * a child of `deploy/run-telemetry-job.sh`, which mints one run id per
   * invocation and exports it before launching the child, so ordinary
   * callers need not pass this at all. An unset env var resolves to
   * `null` (a legitimate hand-run of a job script outside the supervisor).
   * An env var that is SET but EMPTY (or an explicit `runId=""`) is
   * rejected — see the throw below — rather than silently accepted: it is
   * a present value, not an identity, so it would flow straight into
   * `run_id` and be indistinguishable from a pre-migration NULL row to the
   * next guard that compares against it. Tests, and any caller that needs
   * to assert a specific value, pass it explicitly; passing `null`
   * explicitly (rather than omitting the argument) stamps a null run id
   * regardless of the environment.
   */
  runId?: string | null,
): Promise<void> {
  if (guard && guard.onlyIfNotFromRun === "") {
    throw new Error(
      "writeHeartbeat: onlyIfNotFromRun must not be an empty string — " +
        "'run_id is distinct from ' would be true for almost every row, " +
        "silently disabling the guard it was meant to apply.",
    );
  }
  const rawRunId = runId === undefined ? process.env.INTERVU_RUN_ID : runId;
  if (rawRunId === "") {
    throw new Error(
      "writeHeartbeat: run id must not be an empty string — an empty string " +
        "is a present value, not an identity, so a row stamped with it is " +
        "indistinguishable from a pre-migration row (run_id is null) and " +
        "will be overwritten by the next supervisor write that guards on " +
        "run_id being distinct from its own id.",
    );
  }
  const resolvedRunId = rawRunId ?? null;
  const params: unknown[] = [jobName, rowsAffected, ok, resolvedRunId];
  let where = "";
  if (guard) {
    params.push(guard.onlyIfNotFromRun);
    where = ` where intervu.job_heartbeats.run_id is distinct from $${params.length}`;
  }
  await db.query(
    `insert into intervu.job_heartbeats (job_name, last_run_at, rows_affected, ok, run_id)
     values ($1, now(), $2, $3, $4)
     on conflict (job_name) do update
       set last_run_at   = excluded.last_run_at,
           rows_affected = excluded.rows_affected,
           ok            = excluded.ok,
           run_id        = excluded.run_id${where}`,
    params,
  );
}
