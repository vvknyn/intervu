#!/usr/bin/env node
/**
 * SPEC-2-PROFILES.md is not in this repo — see docs/telemetry/SPEC-PROVENANCE.md.
 *
 * Nightly rollup of `intervu.telemetry_events` into `job_daily`,
 * `company_daily`, and `feature_outcomes` — SPEC-2-PROFILES.md §8 step 2/3.
 *
 * Reads a trailing window of raw events and, for each of the three
 * destination tables, REPLACES that window's rows outright (upsert on the
 * table's natural key, via the same `buildUpsert` helper
 * `build-job-features.ts` uses) — never `count = count + n`. Re-running
 * this script for the same window therefore reproduces, not doubles, the
 * same numbers: a retried cron cannot double anyone's clicks.
 *
 * TWO separately-tunable windows, not one shared number — `job_daily` and
 * `company_daily` are keyed on (key, day), so each night's run only ever
 * needs to touch the handful of recent days that could still be settling;
 * a long window there would rewrite years of already-settled history for
 * nothing (`--window-days=N`, default 2). `feature_outcomes` carries no day
 * column at all — its (feature, bucket, position) row IS its whole window,
 * so a short slice there wouldn't miss a "day", it would silently discard
 * everything older than the slice on every replace. It must read the full
 * span the raw ledger can still answer for: the 90-day retention enforced
 * by `select intervu.reap_telemetry(90)` in the installed crontab
 * (`--feature-window-days=N`, default 90 — tied to that retention number by
 * convention, not by any shared code, so a future change to one belongs
 * with a matching change to the other). When the two windows are equal,
 * the same fetched rows are reused for both tables' aggregation rather than
 * querying the same range twice.
 *
 * Connects as `pipeline` (BATCH_PG_URL), same role/reasoning as
 * `build-job-features.ts` — see that script's doc comment.
 *
 * KNOWN GAP, flagged not improvised: this script does NOT populate
 * `intervu.query_daily`, and this is still true as of 2026-09-04 — but the
 * reason narrowed, it didn't close. This script's source, the client
 * ledger (`intervu.telemetry_events`), still has no event that carries both
 * the raw query text and a joinable id: `search_submitted` DOES carry the
 * raw text (`LedgerOnlyPayloads.query_text`, src/lib/analytics/events.ts:229,
 * emitted at src/app/jobs/page.tsx:1467 as the third `ledgerOnly` arg, never
 * forwarded to PostHog) — but no `query_id`, because `searchId`
 * (src/actions/jobs.ts:85) is generated server-side inside the search
 * *response* and does not exist yet at submit time. `result_clicked` and the
 * impression rows (src/app/jobs/page.tsx:2462, :3466;
 * src/lib/jobs/use-result-impressions.ts:67) carry `query_id` but no query
 * text. So THIS script still cannot join a search to its clicks, and still
 * leaves `query_daily` alone every night — that remains a deliberate
 * choice, not a TODO.
 *
 * What changed: the pairing this script is missing already exists
 * server-side, just not in this script's source. `intervu.search_events` /
 * `intervu.search_opens` — the Firestore-mirrored output of the OLDER
 * search-log system (src/lib/jobs/search-log.ts), a different system from
 * the client ledger above — carry a `search_id` on BOTH tables
 * (search_events_search_id_idx / search_opens_search_id_idx,
 * deploy/db-box/intervu-schema.sql) alongside the raw query text, so a
 * search-to-click join is answerable there today. `scripts/backfill-query-daily.ts`
 * reads that mirror to populate `query_daily`'s
 * searches/zero_result_count/click_through_count HISTORICALLY, as a
 * one-time backfill — it is not a cron, nothing installs it in crontab, and
 * it does not change what this script does. `refinement_count` stays
 * unpopulated by either path: it needs grouping consecutive searches by the
 * same person, and neither the mirror nor this ledger carries any
 * session/visitor/user key at all (`deploy/db-box/telemetry-derived.sql`
 * migrated that column to nullable for exactly this reason — see its
 * `query_daily` comment block).
 *
 * KNOWN GAP: `company_daily`'s impressions/clicks/applies/saves are always
 * empty today too, for the same "STOP and report" reason. SPEC.md models
 * `company_domain` as a top-level ledger column, but the client emitter
 * (`extractLedgerColumns`, src/lib/telemetry/client.ts) only ever promotes
 * it from a payload that HAS a `company_domain` key — and none of
 * `results_impressed`/`result_clicked`/`apply_clicked`/`job_saved` (the four
 * outcome events this rollup reads) carry one (`EventPayloads`,
 * src/lib/analytics/events.ts). Only `job_viewed`/`company_followed`/
 * `company_viewed`/`company_unfollowed` do, and none of those are outcome
 * kinds. `aggregateDailyMetrics` already does the honest thing by
 * construction — it drops any event whose grouping key is null rather than
 * inventing one — so no code change is needed here to stay correct once the
 * emitter is fixed; today it just means `company_daily` populates as fast
 * as `telemetry_pg`'s actual rows do, which is not at all.
 *
 * Impressions arrive as PARALLEL ARRAYS, not scalar columns:
 * `results_impressed` puts `job_ids: string[]` / `positions: number[]`
 * inside `props` (SPEC §5's position-fix, applied without forking the
 * existing wire shape — see the field's own doc comment in
 * `EventPayloads`), so every `results_impressed` ROW in `telemetry_events`
 * has `job_id`/`position` NULL by design. Reading only the scalar columns
 * would silently compute an impression denominator of zero for every job
 * and bucket. `fetchWindowImpressions` (src/lib/telemetry/rollup-fetch.ts)
 * unnests those two JSONB arrays (zipped by their shared 1-based
 * ordinality) into one synthetic per-(job_id, position) impression row per
 * array entry, which is then merged with the scalar-column events before
 * aggregation.
 *
 * A résumé-shaped list (listShapedByResume) sends `count` but omits
 * `job_ids`/`positions`: it adds to the logged `impressions_total` volume
 * (`fetchWindowImpressionCounts`) and to nothing per-job or
 * position-corrected, because there is no job or position to attribute.
 *
 * Usage: npx tsx scripts/roll-up-telemetry.ts [--window-days=2] [--feature-window-days=90]
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Queryable } from "@/lib/pg/pool";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";
import { upsertRows } from "@/lib/pg/upsert";
import { buildJobFeaturesSelect } from "@/lib/telemetry/job-features-columns";
import type { JobFeatures } from "@/lib/telemetry/features";
import {
  aggregateDailyMetrics,
  impressionVolumeByDay,
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
import { fetchRollupEvents, fetchWindowImpressionCounts, resolveWindowDays } from "@/lib/telemetry/rollup-fetch";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const JOB_NAME = "roll-up-telemetry";

const connectionString = process.env.BATCH_PG_URL;

const WINDOW_DAYS = resolveWindowDays(process.argv, "window-days", 2);
// Default 90 == the raw retention `select intervu.reap_telemetry(90)`
// enforces in the installed crontab — see the module doc's "TWO
// separately-tunable windows" note for why this is not shared with
// WINDOW_DAYS above.
const FEATURE_WINDOW_DAYS = resolveWindowDays(process.argv, "feature-window-days", 90);

/** `aggregateFeatureOutcomes` only ever looks up a row by the job_id on an
 *  outcome event (`featuresByJobId.get(event.job_id)`, feature-outcomes.ts)
 *  and skips silently when absent — every other row in `job_features` is
 *  provably unreachable for this call, so loading the whole table was pure
 *  waste. Callers pass exactly the ids the current window's outcome events
 *  reference. An empty list short-circuits before any query, both because
 *  there is nothing to look up and to guarantee this never degrades into a
 *  full-table read. */
async function fetchJobFeaturesByIds(
  db: Queryable,
  jobIds: readonly string[],
): Promise<Map<string, JobFeatures>> {
  if (jobIds.length === 0) return new Map();
  const { text, params } = buildJobFeaturesSelect(jobIds);
  const { rows } = await db.query<JobFeatures>(text, params);
  return new Map(rows.map((row) => [row.job_id, row]));
}

/** `feature_outcomes` has no "saves" column — narrows the 4-value wire
 *  classification down to the 3 kinds that table tracks. Events that
 *  classify to "save" (or carry no position) are excluded here, not
 *  silently coerced into one of the three that remain. */
function toFeatureOutcomeEvents(events: readonly DailyEventRow[]): OutcomeEventRow[] {
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
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");

  const db = new pg.Client({ connectionString });
  await db.connect();

  let rowsAffected = 0;
  try {
    const { dailyEvents, featureEvents } = await fetchRollupEvents(db, WINDOW_DAYS, FEATURE_WINDOW_DAYS);

    const volume = impressionVolumeByDay(await fetchWindowImpressionCounts(db, WINDOW_DAYS));
    const volumeTotal = [...volume.values()].reduce((n, v) => n + v.total, 0);
    const volumePositioned = [...volume.values()].reduce((n, v) => n + v.positioned, 0);

    const jobDailyRows = toJobDailyRows(aggregateDailyMetrics(dailyEvents, (e) => e.job_id));
    const companyDailyRows = toCompanyDailyRows(
      aggregateDailyMetrics(dailyEvents, (e) => e.company_domain),
    );

    const featureOutcomeEvents = toFeatureOutcomeEvents(featureEvents);
    const featureJobIds = [...new Set(featureOutcomeEvents.map((e) => e.job_id))];
    const featuresByJobId = await fetchJobFeaturesByIds(db, featureJobIds);
    const featureOutcomeRows = aggregateFeatureOutcomes(featureOutcomeEvents, featuresByJobId);

    if (jobDailyRows.length > 0) {
      rowsAffected += await upsertRows<JobDailyRow>(
        db,
        "intervu.job_daily",
        [
          "job_id", "day", "impressions", "clicks", "applies", "saves", "dismissals",
          "median_dwell_ms", "mean_position",
        ] as const,
        ["job_id", "day"],
        jobDailyRows,
        ["computed_at"],
      );
    }

    if (companyDailyRows.length > 0) {
      rowsAffected += await upsertRows<CompanyDailyRow>(
        db,
        "intervu.company_daily",
        [
          "company_domain", "day", "impressions", "clicks", "applies", "saves", "dismissals",
          "median_dwell_ms", "mean_position",
        ] as const,
        ["company_domain", "day"],
        companyDailyRows,
        ["computed_at"],
      );
    }

    if (featureOutcomeRows.length > 0) {
      rowsAffected += await upsertRows<FeatureOutcomeRow>(
        db,
        "intervu.feature_outcomes",
        ["feature", "bucket", "position", "impressions", "clicks", "applies"] as const,
        ["feature", "bucket", "position"],
        featureOutcomeRows,
        ["computed_at"],
      );
    }

    await writeHeartbeat(db, JOB_NAME, rowsAffected, true);
    console.log(
      `${JOB_NAME}: window=${WINDOW_DAYS}d feature_window=${FEATURE_WINDOW_DAYS}d ` +
        `job_daily=${jobDailyRows.length} company_daily=${companyDailyRows.length} ` +
        `feature_outcomes=${featureOutcomeRows.length} ` +
        `impressions_total=${volumeTotal} impressions_positioned=${volumePositioned}`,
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
