#!/usr/bin/env node
/**
 * Retention reaper for the telemetry ledger (`intervu.telemetry_events`).
 *
 *   npx tsx scripts/reap-telemetry.ts
 *   npx tsx scripts/reap-telemetry.ts --retain-days=90   # default
 *
 * WHY THIS DOESN'T JUST `select intervu.reap_telemetry($1)`:
 * that function (deploy/db-box/telemetry-schema.sql) issues its DELETE as
 * one statement inside one plpgsql-function transaction. telemetry_events
 * is the highest-write table this system owns (see that file's own
 * GIN-index comment) — the first real reap could touch up to 90 days of
 * accumulated rows in a single transaction: a long lock and a large WAL
 * burst against a table other writers hit constantly. A plpgsql FUNCTION
 * cannot commit mid-transaction, so the batching has to live outside it.
 * This script deletes in small, separately-committed batches until nothing
 * more matches the SAME retention predicate `reap_telemetry()` uses
 * (`received_at` older than N days), then writes exactly one heartbeat row
 * for the whole run under the SAME job_name that function itself would
 * have used — one retention window, one heartbeat identity, regardless of
 * which of the two ever actually runs. `reap_telemetry()` is left in place
 * as a manual/ad-hoc tool; this cron path does not call it.
 *
 * Every run — including one that deletes nothing — upserts
 * `intervu.job_heartbeats`, because five daily crons in this system once
 * ran dead for up to ten days while exiting 0 every time; a heartbeat that
 * only appears on success proves nothing. The upsert itself lives in
 * `writeHeartbeat` (src/lib/telemetry/heartbeat.ts) — shared with
 * build-job-features.ts/roll-up-telemetry.ts so this exact statement has
 * one writer, not a copy re-typed per script.
 *
 * Runs FROM THE PIPELINE BOX (194.163.147.154) as user `subspace`, reading
 * `BATCH_PG_URL` out of /opt/interview-os/.env.local — the same connection
 * every other box script in deploy/db-box/ uses, and the role
 * `reap_telemetry()`'s own comment names as this table's owner. Never
 * `TELEMETRY_PG_URL`: that role (`telemetry_pg`) is insert-only by design
 * (telemetry-schema.sql §4) and cannot issue a DELETE. See
 * deploy/db-box/README-telemetry-cron.md for the crontab line.
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";
import { TELEMETRY_LEDGER_RETAIN_DAYS } from "@/lib/telemetry/retention";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const JOB_NAME = "reap_telemetry";
const BATCH_SIZE = 5000; // rows per committed DELETE

const retainArg = process.argv.find((a) => a.startsWith("--retain-days="));
const retainDays = retainArg
  ? Number(retainArg.slice("--retain-days=".length))
  : TELEMETRY_LEDGER_RETAIN_DAYS;
if (!Number.isInteger(retainDays) || retainDays <= 0) {
  console.error(`invalid --retain-days: ${retainArg}`);
  process.exit(1);
}

const connectionString = process.env.BATCH_PG_URL;
if (!connectionString) {
  console.error("no pg url: set BATCH_PG_URL in .env.local");
  process.exit(1);
}

/**
 * Deletes up to `BATCH_SIZE` expired rows as one committed statement,
 * returning how many actually went via `RETURNING` — never an assumed
 * count. `ctid IN (SELECT ctid ... LIMIT N)` bounds the DELETE itself
 * (a plain `DELETE ... LIMIT` isn't valid SQL), so each call is its own
 * small, fast transaction rather than one that can grow unboundedly.
 */
async function deleteOneBatch(db: pg.Client, days: number): Promise<number> {
  const { rows } = await db.query(
    `DELETE FROM intervu.telemetry_events
     WHERE ctid IN (
       SELECT ctid FROM intervu.telemetry_events
       WHERE received_at < now() - ($1 || ' days')::interval
       LIMIT $2
     )
     RETURNING id`,
    [String(days), BATCH_SIZE],
  );
  return rows.length;
}

async function main() {
  const db = new pg.Client({ connectionString });
  await db.connect();

  let totalDeleted = 0;
  try {
    for (;;) {
      const deleted = await deleteOneBatch(db, retainDays);
      totalDeleted += deleted;
      if (deleted < BATCH_SIZE) break;
    }
    await writeHeartbeat(db, JOB_NAME, totalDeleted, true);
    console.log(`ok rows_deleted=${totalDeleted} retain_days=${retainDays}`);
  } catch (err) {
    // The heartbeat must land even on failure, with the REAL partial count
    // — a heartbeat that only appears on success is exactly the blind spot
    // it exists to close.
    await writeHeartbeat(db, JOB_NAME, totalDeleted, false).catch((hbErr) => {
      console.error("[reap-telemetry] heartbeat write also failed:", hbErr);
    });
    throw err;
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reap-telemetry] failed:", err);
    process.exit(1);
  });
