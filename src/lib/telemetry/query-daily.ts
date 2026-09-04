/**
 * Pure day-bucketed aggregation for `intervu.query_daily` — see
 * `deploy/db-box/telemetry-derived.sql`'s `job_daily / company_daily /
 * query_daily` comment block for why this table needed a different writer
 * than `roll-up-telemetry.ts` (job_daily/company_daily's shared engine,
 * `daily-rollup.ts`) and `scripts/backfill-query-daily.ts` for the one-time
 * history backfill that uses this module.
 *
 * Three of the table's four metric columns are measurable from
 * `intervu.search_events` / `intervu.search_opens` (the Firestore-mirrored
 * output of the older search-log system, `src/lib/jobs/search-log.ts`):
 *
 *   - searches             — one per typed search (empty-`q` default-browse
 *                             rows are excluded before a row ever reaches
 *                             this function; see query-daily-fetch.ts).
 *   - zero_result_count    — searches whose `resultCount` was 0.
 *   - click_through_count  — searches with AT LEAST ONE matching
 *                             `search_opens` row. This is a count of
 *                             SEARCHES, not opens: a search opened twice
 *                             still counts once, the same way a job page
 *                             visited twice isn't two "clicks" on the
 *                             search that led there. Counting `open_count`
 *                             itself here (instead of `open_count > 0`)
 *                             would double an already-measured search and
 *                             is exactly the bug
 *                             tests/unit/query-daily.test.ts's "two opens"
 *                             fixture exists to catch.
 *
 * `refinement_count` is NOT one of this module's outputs — see
 * query-daily-fetch.ts's module doc for why it is unmeasurable from this
 * mirror (no session/visitor/user key anywhere in it) and stays NULL, never
 * a fabricated 0, all the way out to the upserted row.
 *
 * Deterministic and side-effect free, same contract as
 * `aggregateDailyMetrics` (daily-rollup.ts): the same input always produces
 * the same output map, which is what lets `scripts/backfill-query-daily.ts`
 * upsert-replace a (query_normalized, day) row and stay idempotent under a
 * retry.
 */
import { splitGroupKey } from "./daily-rollup";

export interface QueryDailyEventRow {
  /** `lower(btrim(q))` — already normalized in SQL (query-daily-fetch.ts),
   *  never raw `q`; this module never sees or logs the raw search text. */
  query_normalized: string;
  /** 'YYYY-MM-DD', already day-bucketed in SQL — same division of labor as
   *  `DailyEventRow.day` in daily-rollup.ts. */
  day: string;
  result_count: number;
  /** Count of `search_opens` rows joined to this search by `search_id`.
   *  Zero means no open; two or more must still resolve to ONE
   *  click-through (see module doc above) — that collapsing happens in
   *  `aggregateQueryDaily`, not here, so this field intentionally stays a
   *  count rather than a pre-collapsed boolean. */
  open_count: number;
}

export interface QueryDailyMetrics {
  searches: number;
  zero_result_count: number;
  click_through_count: number;
}

function emptyMetrics(): QueryDailyMetrics {
  return { searches: 0, zero_result_count: 0, click_through_count: 0 };
}

/**
 * Groups `events` (one row per typed search) by (query_normalized, day) and
 * counts each group's searches / zero-result searches / click-throughs.
 */
export function aggregateQueryDaily(
  events: readonly QueryDailyEventRow[],
): Map<string, QueryDailyMetrics> {
  const byGroup = new Map<string, QueryDailyMetrics>();

  for (const event of events) {
    // Empty query_normalized is a default-browse (untyped) search. In
    // production `query-daily-fetch.ts`'s WHERE clause is what actually
    // keeps these out of `events` — but that's a performance filter (skip
    // fetching ~23.7k irrelevant rows over the wire), not this function's
    // contract. Guarded again here so "a search" (this function's unit),
    // not "a row that happened to arrive", stays true regardless of what
    // filters a future caller does or doesn't apply upstream.
    if (event.query_normalized === "") continue;

    const groupKey = `${event.query_normalized}|${event.day}`;
    let acc = byGroup.get(groupKey);
    if (!acc) {
      acc = emptyMetrics();
      byGroup.set(groupKey, acc);
    }

    acc.searches++;
    if (event.result_count === 0) acc.zero_result_count++;
    if (event.open_count > 0) acc.click_through_count++;
  }

  return byGroup;
}

export interface QueryDailyRow extends QueryDailyMetrics {
  query_normalized: string;
  day: string;
}

export function toQueryDailyRows(byGroup: ReadonlyMap<string, QueryDailyMetrics>): QueryDailyRow[] {
  return [...byGroup.entries()].map(([groupKey, metrics]) => {
    const { key, day } = splitGroupKey(groupKey);
    return { query_normalized: key, day, ...metrics };
  });
}
