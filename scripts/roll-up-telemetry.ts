#!/usr/bin/env node
/**
 * Nightly rollup of `intervu.telemetry_events` into `job_daily`,
 * `company_daily`, and `feature_outcomes` — SPEC-2-PROFILES.md §8 step 2/3.
 *
 * Reads a trailing window of raw events (default 2 days, `--window-days=N`
 * to override) and, for each of the three destination tables, REPLACES that
 * window's rows outright (upsert on the table's natural key, via the same
 * `buildUpsert` helper `build-job-features.ts` uses) — never
 * `count = count + n`. Re-running this script for the same window therefore
 * reproduces, not doubles, the same numbers: a retried cron cannot double
 * anyone's clicks.
 *
 * Connects as `pipeline` (EXHAUST_PG_URL), same role/reasoning as
 * `build-job-features.ts` — see that script's doc comment.
 *
 * KNOWN GAP, flagged not improvised: this script does NOT populate
 * `intervu.query_daily`. Its primary key is `query_normalized`, but neither
 * `telemetry_events` (query_id is a uuid, not text) nor any analytics
 * payload (`search_submitted`/`search_zero_results` carry only
 * `query_length: number` — see `EventPayloads` in
 * src/lib/analytics/events.ts) exposes the raw query text anywhere this
 * lane can verify. Per SPEC.md's own rule ("if reality contradicts it, STOP
 * and report — do not improvise a different shape"), this script leaves
 * `query_daily` empty rather than guessing a `props` JSON key name.
 *
 * Usage: npx tsx scripts/roll-up-telemetry.ts [--window-days=2]
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";
import { buildUpsert } from "@/lib/pg/upsert";
import {
  JOB_FEATURES_COLUMNS,
  JOB_FEATURES_NUMERIC_COLUMNS,
  JOB_FEATURES_TIMESTAMP_COLUMNS,
} from "@/lib/telemetry/job-features-columns";
import type { JobFeatures } from "@/lib/telemetry/features";
import {
  aggregateDailyMetrics,
  toJobDailyRows,
  toCompanyDailyRows,
  type DailyEventRow,
  type JobDailyRow,
  type CompanyDailyRow,
} from "@/lib/telemetry/daily-rollup";
import {
  aggregateFeatureOutcomes,
  type FeatureOutcomeKind,
  type FeatureOutcomeRow,
  type OutcomeEventRow,
} from "@/lib/telemetry/feature-outcomes";
import { classifyOutcomeEvent } from "@/lib/telemetry/outcome-events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const JOB_NAME = "roll-up-telemetry";

const connectionString = process.env.EXHAUST_PG_URL;

const windowArg = process.argv.find((a) => a.startsWith("--window-days="));
const WINDOW_DAYS = windowArg ? Number(windowArg.slice("--window-days=".length)) : 2;

interface RawEventRow {
  event_name: string;
  day: string;
  job_id: string | null;
  company_domain: string | null;
  position: number | null;
}

async function fetchWindowEvents(db: pg.Client, windowDays: number): Promise<RawEventRow[]> {
  // Day-bucketing happens here, in SQL, not in JS Date math — avoids
  // timezone bugs; see daily-rollup.ts's module doc.
  const { rows } = await db.query<RawEventRow>(
    `select
       event_name,
       to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD') as day,
       job_id,
       company_domain,
       position
     from intervu.telemetry_events
     where occurred_at >= now() - make_interval(days => $1)`,
    [windowDays],
  );
  return rows;
}

async function fetchAllJobFeatures(db: pg.Client): Promise<Map<string, JobFeatures>> {
  const selectList = JOB_FEATURES_COLUMNS.map((col) => {
    if (JOB_FEATURES_NUMERIC_COLUMNS.includes(col)) return `${col}::float8 as ${col}`;
    if (JOB_FEATURES_TIMESTAMP_COLUMNS.includes(col)) return `${col}::text as ${col}`;
    return col;
  }).join(", ");

  const { rows } = await db.query<JobFeatures>(`select ${selectList} from intervu.job_features`);
  return new Map(rows.map((row) => [row.job_id, row]));
}

/** `feature_outcomes` has no "saves" column — narrows the 4-value wire
 *  classification down to the 3 kinds that table tracks. Events that
 *  classify to "save" (or carry no position) are excluded here, not
 *  silently coerced into one of the three that remain. */
function toFeatureOutcomeEvents(events: readonly RawEventRow[]): OutcomeEventRow[] {
  const SAVE: FeatureOutcomeKind[] = ["impression", "click", "apply"];
  const out: OutcomeEventRow[] = [];
  for (const event of events) {
    if (event.job_id == null || event.position == null) continue;
    const kind = classifyOutcomeEvent(event.event_name);
    if (kind === null || !SAVE.includes(kind as FeatureOutcomeKind)) continue;
    out.push({ job_id: event.job_id, position: event.position, kind: kind as FeatureOutcomeKind });
  }
  return out;
}

async function main() {
  if (!connectionString) throw new Error("EXHAUST_PG_URL is not set");
  if (!Number.isFinite(WINDOW_DAYS) || WINDOW_DAYS <= 0) {
    throw new Error(`--window-days must be a positive number, got ${windowArg}`);
  }

  const db = new pg.Client({ connectionString });
  await db.connect();

  let rowsAffected = 0;
  try {
    const events: DailyEventRow[] = await fetchWindowEvents(db, WINDOW_DAYS);

    const jobDailyRows = toJobDailyRows(aggregateDailyMetrics(events, (e) => e.job_id));
    const companyDailyRows = toCompanyDailyRows(
      aggregateDailyMetrics(events, (e) => e.company_domain),
    );

    const featuresByJobId = await fetchAllJobFeatures(db);
    const featureOutcomeRows = aggregateFeatureOutcomes(
      toFeatureOutcomeEvents(events),
      featuresByJobId,
    );

    if (jobDailyRows.length > 0) {
      const { text, params } = buildUpsert<JobDailyRow>(
        "intervu.job_daily",
        [
          "job_id", "day", "impressions", "clicks", "applies", "saves", "dismissals",
          "median_dwell_ms", "mean_position",
        ] as const,
        ["job_id", "day"],
        jobDailyRows,
      );
      await db.query(text, params);
      rowsAffected += jobDailyRows.length;
    }

    if (companyDailyRows.length > 0) {
      const { text, params } = buildUpsert<CompanyDailyRow>(
        "intervu.company_daily",
        [
          "company_domain", "day", "impressions", "clicks", "applies", "saves", "dismissals",
          "median_dwell_ms", "mean_position",
        ] as const,
        ["company_domain", "day"],
        companyDailyRows,
      );
      await db.query(text, params);
      rowsAffected += companyDailyRows.length;
    }

    if (featureOutcomeRows.length > 0) {
      const { text, params } = buildUpsert<FeatureOutcomeRow>(
        "intervu.feature_outcomes",
        ["feature", "bucket", "position", "impressions", "clicks", "applies"] as const,
        ["feature", "bucket", "position"],
        featureOutcomeRows,
      );
      await db.query(text, params);
      rowsAffected += featureOutcomeRows.length;
    }

    await writeHeartbeat(db, JOB_NAME, rowsAffected, true);
    console.log(
      `${JOB_NAME}: window=${WINDOW_DAYS}d job_daily=${jobDailyRows.length} ` +
        `company_daily=${companyDailyRows.length} feature_outcomes=${featureOutcomeRows.length}`,
    );
  } catch (err) {
    // Report the real count reached before the failure, never a fabricated
    // one — a heartbeat that lies about rows_affected is worse than none.
    await writeHeartbeat(db, JOB_NAME, rowsAffected, false).catch(() => {});
    throw err;
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
