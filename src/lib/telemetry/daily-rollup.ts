/**
 * Pure day-bucketed aggregation for `intervu.job_daily` / `intervu.company_daily`
 * — SPEC-2-PROFILES.md §3. Both tables carry the exact same metric columns
 * (impressions/clicks/applies/saves/dismissals/median_dwell_ms/mean_position)
 * over a different grouping key (job_id vs company_domain), so one generic
 * function serves both instead of two copies of the same accumulation loop.
 *
 * Day-bucketing itself happens in SQL (`to_char(received_at at time zone
 * 'utc', 'YYYY-MM-DD')`, see roll-up-telemetry.ts) — this module only
 * classifies and counts rows already labeled with their day; no timezone
 * math happens here.
 *
 * No "dismissals" producer exists yet (see outcome-events.ts) — every row
 * this module emits carries a real `dismissals: 0`, not a guess.
 *
 * GAP, flagged not improvised: `job_daily.median_dwell_ms` /
 * `company_daily.median_dwell_ms` have no verified data source. No event in
 * `ANALYTICS_EVENTS` (src/lib/analytics/events.ts) carries a dwell/duration
 * field on a job result today. The column is nullable with no default in
 * the DDL for exactly this reason; this module always emits
 * `median_dwell_ms: null` ("not measured", never 0) until such an event
 * exists, rather than guessing a computation from timestamps that were
 * never designed to measure dwell.
 */
import { classifyOutcomeEvent, type OutcomeKind } from "./outcome-events";

export interface DailyEventRow {
  event_name: string;
  day: string; // 'YYYY-MM-DD', already bucketed in SQL
  job_id: string | null;
  company_domain: string | null;
  position: number | null;
}

export interface DailyMetrics {
  impressions: number;
  clicks: number;
  applies: number;
  saves: number;
  dismissals: number;
  /** Positions observed on `result_clicked`/`results_impressed` rows that
   *  carried one; null (not 0) when nothing in the window carried a
   *  position — a mean of zero rows is not the fact "position 0". */
  mean_position: number | null;
  /** Always null today — see the module doc's GAP note. */
  median_dwell_ms: number | null;
}

function emptyMetrics(): DailyMetrics {
  return {
    impressions: 0,
    clicks: 0,
    applies: 0,
    saves: 0,
    dismissals: 0,
    mean_position: null,
    median_dwell_ms: null,
  };
}

interface Accumulator extends DailyMetrics {
  positionSum: number;
  positionCount: number;
}

const OUTCOME_TO_METRIC: Record<OutcomeKind, "impressions" | "clicks" | "applies" | "saves"> = {
  impression: "impressions",
  click: "clicks",
  apply: "applies",
  save: "saves",
};

/**
 * Groups `events` by `keyOf(event)` and by day, and sums each group's
 * classified event counts. Deterministic and side-effect free: the same
 * input always produces the same output map, which is what lets the
 * rollup script upsert-replace a window's rows and stay idempotent under a
 * retry (see roll-up-telemetry.ts).
 */
export function aggregateDailyMetrics<K extends string>(
  events: readonly DailyEventRow[],
  keyOf: (event: DailyEventRow) => K | null,
): Map<string, DailyMetrics> {
  const byGroup = new Map<string, Accumulator>();

  for (const event of events) {
    const key = keyOf(event);
    if (key === null) continue;
    const kind = classifyOutcomeEvent(event.event_name);
    if (kind === null) continue;

    const groupKey = `${key}|${event.day}`;
    let acc = byGroup.get(groupKey);
    if (!acc) {
      acc = { ...emptyMetrics(), positionSum: 0, positionCount: 0 };
      byGroup.set(groupKey, acc);
    }

    acc[OUTCOME_TO_METRIC[kind]]++;
    if (event.position != null) {
      acc.positionSum += event.position;
      acc.positionCount++;
    }
  }

  const result = new Map<string, DailyMetrics>();
  for (const [groupKey, acc] of byGroup) {
    result.set(groupKey, {
      impressions: acc.impressions,
      clicks: acc.clicks,
      applies: acc.applies,
      saves: acc.saves,
      dismissals: acc.dismissals,
      mean_position: acc.positionCount > 0 ? acc.positionSum / acc.positionCount : null,
      median_dwell_ms: null,
    });
  }
  return result;
}

export interface JobDailyRow extends DailyMetrics {
  job_id: string;
  day: string;
}

export interface CompanyDailyRow extends DailyMetrics {
  company_domain: string;
  day: string;
}

/** Splits an `aggregateDailyMetrics`-style group key ("<key>|<day>") back
 *  into its two parts. `day` is always exactly 10 chars ('YYYY-MM-DD'), so a
 *  `key` containing "|" itself (none do today — job_id/company_domain are
 *  URL/id safe) still splits correctly by taking the day off the
 *  fixed-width tail. Exported for reuse by query-daily.ts, which groups on
 *  the same "<key>|<day>" shape (query_normalized instead of job_id/
 *  company_domain) and would otherwise need a byte-for-byte copy of this
 *  same slicing logic. */
export function splitGroupKey(groupKey: string): { key: string; day: string } {
  const day = groupKey.slice(-10);
  const key = groupKey.slice(0, -"|".length - day.length);
  return { key, day };
}

export function toJobDailyRows(byGroup: ReadonlyMap<string, DailyMetrics>): JobDailyRow[] {
  return [...byGroup.entries()].map(([groupKey, metrics]) => {
    const { key, day } = splitGroupKey(groupKey);
    return { job_id: key, day, ...metrics };
  });
}

export function toCompanyDailyRows(byGroup: ReadonlyMap<string, DailyMetrics>): CompanyDailyRow[] {
  return [...byGroup.entries()].map(([groupKey, metrics]) => {
    const { key, day } = splitGroupKey(groupKey);
    return { company_domain: key, day, ...metrics };
  });
}
