#!/usr/bin/env node
/**
 * One-time HISTORY backfill of `intervu.query_daily` from the
 * Firestore-mirrored search-log tables (`intervu.search_events` /
 * `intervu.search_opens`) — NOT a nightly cron, and not installed in any
 * crontab. See `deploy/db-box/telemetry-derived.sql`'s `query_daily`
 * comment block and `scripts/roll-up-telemetry.ts`'s updated KNOWN GAP note
 * for why the nightly rollup still can't populate this table from the
 * newer client ledger, while this script can from the older mirror.
 *
 * Populates three of the table's four columns — `searches`,
 * `zero_result_count`, `click_through_count` — via `aggregateQueryDaily`
 * (src/lib/telemetry/query-daily.ts). `refinement_count` is never written
 * here (see that module's doc): the mirror carries no session/visitor/user
 * key at all, so grouping consecutive searches by "the same person" is not
 * answerable from it. `deploy/db-box/telemetry-derived.sql` migrated that
 * column to nullable for exactly this reason — every row this script
 * upserts leaves it at its column default, which is now NULL, never a
 * fabricated 0.
 *
 * Upserts on (query_normalized, day) via the same `buildUpsert` helper
 * `roll-up-telemetry.ts`/`build-job-features.ts` use, so a retried run
 * reproduces the same rows rather than doubling them.
 *
 * Safe by default: with no flags (or `--dry-run`), this only reads and
 * prints a summary — no write, no heartbeat. `--write` is required,
 * explicitly, to perform the upsert; there is no default that writes.
 *
 * Usage:
 *   npx tsx scripts/backfill-query-daily.ts             # dry run (default)
 *   npx tsx scripts/backfill-query-daily.ts --dry-run    # same, explicit
 *   npx tsx scripts/backfill-query-daily.ts --write      # perform the upsert
 *
 * `q` is raw user search text: this script never prints a sample value,
 * only aggregate counts (see query-daily-fetch.ts's own doc).
 *
 * Connects as `pipeline` (BATCH_PG_URL), same role/reasoning as
 * `roll-up-telemetry.ts` / `build-job-features.ts`.
 */
import { config } from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeHeartbeat } from "@/lib/telemetry/heartbeat";
import { buildUpsert } from "@/lib/pg/upsert";
import { aggregateQueryDaily, toQueryDailyRows, type QueryDailyRow } from "@/lib/telemetry/query-daily";
import { fetchQueryDailyEvents } from "@/lib/telemetry/query-daily-fetch";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

const JOB_NAME = "backfill-query-daily";
const WRITE = process.argv.includes("--write");

const connectionString = process.env.BATCH_PG_URL;

function summarize(rows: readonly QueryDailyRow[]) {
  const distinctQueries = new Set(rows.map((r) => r.query_normalized)).size;
  const days = rows.map((r) => r.day).sort();
  const span = days.length > 0 ? `${days[0]}..${days[days.length - 1]}` : "none";
  const totals = rows.reduce(
    (acc, r) => ({
      searches: acc.searches + r.searches,
      zero_result_count: acc.zero_result_count + r.zero_result_count,
      click_through_count: acc.click_through_count + r.click_through_count,
    }),
    { searches: 0, zero_result_count: 0, click_through_count: 0 },
  );
  return { distinctQueries, span, totals };
}

async function main() {
  if (!connectionString) throw new Error("BATCH_PG_URL is not set");

  const db = new pg.Client({ connectionString });
  await db.connect();

  try {
    const events = await fetchQueryDailyEvents(db);
    const rows = toQueryDailyRows(aggregateQueryDaily(events));
    const { distinctQueries, span, totals } = summarize(rows);

    console.log(
      `${JOB_NAME}: ${rows.length} rows, ${distinctQueries} distinct queries, span ${span}, ` +
        `totals: searches=${totals.searches} zero_result=${totals.zero_result_count} ` +
        `click_through=${totals.click_through_count}`,
    );

    if (!WRITE) {
      console.log(`${JOB_NAME}: dry-run — no write performed. Pass --write to upsert into intervu.query_daily.`);
      return;
    }

    if (rows.length > 0) {
      const { text, params } = buildUpsert<QueryDailyRow>(
        "intervu.query_daily",
        ["query_normalized", "day", "searches", "zero_result_count", "click_through_count"] as const,
        ["query_normalized", "day"],
        rows,
        ["computed_at"],
      );
      await db.query(text, params);
    }
    await writeHeartbeat(db, JOB_NAME, rows.length, true);
    console.log(`${JOB_NAME}: wrote ${rows.length} rows.`);
  } catch (err) {
    if (WRITE) {
      // Report the real count reached before the failure (zero — the single
      // upsert statement above either ran in full or not at all), never a
      // fabricated one. No heartbeat at all on a dry run: it made no write,
      // so a heartbeat row would claim a run that didn't touch the table.
      await writeHeartbeat(db, JOB_NAME, 0, false).catch(() => {});
    }
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
