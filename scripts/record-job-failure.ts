#!/usr/bin/env node
/**
 * Invoked ONLY by deploy/run-telemetry-job.sh, immediately after a
 * supervised job's child process exits non-zero (an ordinary failure,
 * INTERVU_JOB_TIMEOUT, or a signal/OOM kill). The wrapper is the one
 * process that survives a child's death, so it is the only place that can
 * record that the death happened at all — see src/lib/telemetry/heartbeat.ts's
 * module doc for the gap this closes: a job killed before it reaches its own
 * try/catch used to write nothing to intervu.job_heartbeats, making "never
 * started" and "started and died mid-run" indistinguishable.
 *
 * Writes a terminal ok=false row (rows_affected=null — the wrapper does not
 * know how far the job got, and null is honest where 0 would claim the job
 * completed having touched nothing) via the SAME `writeHeartbeat` every job
 * script uses, passing its `onlyIfNotFromRun` guard set to the run's own
 * run id (see heartbeat.ts's module doc for the elapsed-seconds mechanism
 * this replaced and why it clobbered rows). That guard is what stops this
 * from clobbering a row the job already wrote for THIS run: a row already
 * carrying this run's id — whether the child wrote it or a previous attempt
 * at this same recorder write did — is left alone.
 *
 * The run id is read from process.env.INTERVU_RUN_ID, which the wrapper
 * mints once per run and exports before launching either the job or this
 * script, so both processes see the identical value. No fallback here: an
 * unset or empty run id means this script cannot tell its own write apart
 * from any other, so it throws rather than writing a guard that would
 * silently do nothing (see heartbeat.ts's empty-string rejection).
 *
 * Connects the same way every other box script in this family does — a raw
 * `pg.Client` on `BATCH_PG_URL` (the `pipeline` role that owns
 * intervu.job_heartbeats), which the wrapper has already exported into this
 * process's environment before launching either the job or this script. No
 * new credential, no new env var. `connectionTimeoutMillis` matches
 * src/lib/pg/pool.ts's pools (5s) — this write runs while the wrapper still
 * holds the per-job flock (deploy/run-telemetry-job.sh), so an unreachable
 * DB must fail fast rather than pin that lock indefinitely.
 *
 * Usage: record-job-failure.ts <job-name>
 */
import pg from "pg";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";

async function main() {
  const [jobName] = process.argv.slice(2);
  if (!jobName) {
    throw new Error("usage: record-job-failure.ts <job-name>");
  }

  const runId = process.env.INTERVU_RUN_ID;
  if (!runId) {
    throw new Error(
      "INTERVU_RUN_ID is not set — record-job-failure.ts cannot tell its own " +
        "write apart from any other run's without it (see heartbeat.ts's guard)",
    );
  }

  const connectionString = process.env.BATCH_PG_URL;
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");

  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("SET statement_timeout = '5s'");
    await writeHeartbeat(db, jobName, null, false, { onlyIfNotFromRun: runId }, runId);
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
