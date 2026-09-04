#!/usr/bin/env node
/**
 * Exits non-zero when the telemetry pipeline is STARVED (the shared ingest
 * ledger has received nothing recently, so every downstream job's
 * zero-output "success" proves nothing about business activity) and exits
 * zero when it is merely idle-but-healthy (the ledger is alive; a job's own
 * zero output is a real business fact). See src/lib/telemetry/liveness.ts
 * for the predicate and the full reasoning — this script is the thin I/O
 * wrapper: two reads, one classification, one exit code.
 *
 * RUN TODAY (2026-09-04) AND THIS FIRES — that is correct, not a bug.
 * TELEMETRY_PG_URL is not set on the app box, so
 * src/app/api/telemetry/route.ts never inserts into
 * intervu.telemetry_events at all. The ledger has been silent, so
 * roll-up-telemetry's `ok=true rows_affected=0` heartbeat is starvation,
 * not idleness, and this script is supposed to say so loudly rather than
 * agree with the wrapper's green exit code.
 *
 * Connects the same way every other box script in this family does — a raw
 * `pg.Client` on `BATCH_PG_URL` (the `pipeline` role, which owns both
 * tables read below and needs no new credential), `connectionTimeoutMillis`
 * matching src/lib/pg/pool.ts's pools (5s), a `main()` wrapper because tsx
 * transpiles this to CJS and top-level await fails.
 *
 * Usage: npx tsx scripts/check-telemetry-liveness.ts
 */
import pg from "pg";
import {
  classifyTelemetryLiveness,
  DEFAULT_STARVED_AFTER_HOURS,
  type JobHeartbeatRow,
} from "@/lib/telemetry/liveness";

interface HeartbeatQueryRow {
  job_name: string;
  last_run_at: Date;
  rows_affected: string | null; // bigint comes back as string from node-pg
  ok: boolean;
}

function describeAge(at: Date | null, now: Date): string {
  if (at === null) return "never";
  return `${((now.getTime() - at.getTime()) / 3_600_000).toFixed(1)}h ago`;
}

async function main(): Promise<void> {
  const connectionString = process.env.BATCH_PG_URL;
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");

  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  await db.connect();

  let heartbeatRows: HeartbeatQueryRow[];
  let lastEventAt: Date | null;
  try {
    await db.query("SET statement_timeout = '5s'");

    const heartbeatResult = await db.query<HeartbeatQueryRow>(
      "select job_name, last_run_at, rows_affected, ok from intervu.job_heartbeats",
    );
    heartbeatRows = heartbeatResult.rows;

    const eventResult = await db.query<{ last_event_at: Date | null }>(
      "select max(received_at) as last_event_at from intervu.telemetry_events",
    );
    lastEventAt = eventResult.rows[0]?.last_event_at ?? null;
  } finally {
    await db.end();
  }

  const heartbeats: JobHeartbeatRow[] = heartbeatRows.map((r) => ({
    jobName: r.job_name,
    lastRunAt: new Date(r.last_run_at),
    rowsAffected: r.rows_affected === null ? null : Number(r.rows_affected),
    ok: r.ok,
  }));

  const now = new Date();
  const staleAfterMs = DEFAULT_STARVED_AFTER_HOURS * 60 * 60 * 1000;
  const eventAge = describeAge(lastEventAt, now);

  // Collected rather than thrown-on-first: a dead heartbeat writer and a
  // starved ledger are independent failures, and the first version of this
  // script (like the B7 gap in the classifier it wraps) would report
  // healthy on a completely empty job_heartbeats table — an inverted alarm
  // for the worst case, cron dying entirely.
  const findings: string[] = [];

  if (heartbeatRows.length === 0) {
    findings.push(
      "NO HEARTBEATS: intervu.job_heartbeats returned zero rows — nothing is reporting at all, " +
        "which is a worse signal than any individual job being stale.",
    );
  }

  const result = classifyTelemetryLiveness(heartbeats, lastEventAt, now, staleAfterMs);

  if (result.silentJobs.length > 0) {
    const named = heartbeats
      .filter((h) => result.silentJobs.includes(h.jobName))
      .map((h) => `${h.jobName} (${describeAge(h.lastRunAt, now)})`)
      .join(", ");
    findings.push(
      `SILENT: [${named}] have not reported within the ${DEFAULT_STARVED_AFTER_HOURS}h freshness window — ` +
        `the job stopped running, this is not idle-but-healthy.`,
    );
  }

  if (result.starved) {
    findings.push(
      `STARVED: intervu.telemetry_events last received an event ${eventAge} ` +
        `(older than the ${DEFAULT_STARVED_AFTER_HOURS}h freshness window) while ` +
        `[${result.starvedJobs.join(", ")}] reported ok=true rows_affected=0 within that ` +
        `same window. These job(s) ran and COULD NOT have done anything — the ingest ` +
        `ledger itself is dead, this is not idle-but-healthy.`,
    );
  }

  if (findings.length > 0) {
    throw new Error(findings.join("\n"));
  }

  const idleNote =
    result.idleHealthyJobs.length > 0
      ? ` [${result.idleHealthyJobs.join(", ")}] reported zero output, but the ledger is fresh — idle-but-healthy.`
      : "";
  const failedNote =
    result.failedJobs.length > 0 ? ` [${result.failedJobs.join(", ")}] reported ok=false within the window.` : "";
  console.log(`OK: intervu.telemetry_events last event ${eventAge}.${idleNote}${failedNote}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
