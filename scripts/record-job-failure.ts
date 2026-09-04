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
 * script uses, passing its `onlyIfOlderThanSeconds` guard set to the run's
 * own elapsed wall-clock time (a duration, not a timestamp — see
 * heartbeat.ts's module doc: the wrapper's clock is a different machine
 * than the one that evaluates `now()` for this write, so the guard must
 * never compare against an absolute app-box timestamp). That guard is what
 * stops this from clobbering a row the job already wrote for THIS run: a
 * child that reached its own try/catch has a `last_run_at` newer than the
 * DB's own now()-minus-elapsed estimate of when the run started, so its
 * richer row always wins.
 *
 * Connects the same way every other box script in this family does — a raw
 * `pg.Client` on `BATCH_PG_URL` (the `pipeline` role that owns
 * intervu.job_heartbeats), which the wrapper has already exported into this
 * process's environment before launching either the job or this script. No
 * new credential, no new env var.
 *
 * Usage: record-job-failure.ts <job-name> <elapsed-seconds>
 */
import pg from "pg";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";

async function main() {
  const [jobName, elapsedSeconds] = process.argv.slice(2);
  if (!jobName || !elapsedSeconds) {
    throw new Error("usage: record-job-failure.ts <job-name> <elapsed-seconds>");
  }

  const connectionString = process.env.BATCH_PG_URL;
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");

  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await writeHeartbeat(db, jobName, null, false, {
      onlyIfOlderThanSeconds: Number(elapsedSeconds),
    });
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
