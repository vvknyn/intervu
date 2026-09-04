/**
 * Single source of truth for what a "day" means across every table under
 * `intervu.*_daily` (`job_daily`, `company_daily` — rollup-fetch.ts;
 * `query_daily` — query-daily-fetch.ts): a UTC calendar day, always, never
 * the database session's or the host machine's local timezone.
 *
 * This is not cosmetic. `job_daily.day` / `company_daily.day` /
 * `query_daily.day` are the join key for any cross-table analysis
 * ("which days had high query volume AND high job-view volume"). If two of
 * these three tables bucketed "day" on different timezone definitions,
 * every such join would misalign by the UTC/local offset at every day
 * boundary — silently pairing the wrong days together, not erroring.
 *
 * Measured evidence this is a real, not hypothetical, risk: this file
 * replaces a version of `query-daily-fetch.ts` that bucketed
 * `intervu.search_events` on `Europe/Berlin` (this box's Postgres session
 * default `timezone` GUC) instead of UTC. On the same 4,164 typed searches,
 * Berlin bucketing produced 786 distinct (query_normalized, day) pairs;
 * UTC bucketing produces 793 — a 7-pair difference entirely at instants in
 * the 22:00-24:00 UTC hour, where Berlin (UTC+1/+2) has already rolled
 * into the next calendar day. Cross-checked directly against Postgres with
 * a literal boundary instant, 2026-08-23T23:30:00Z: UTC day 2026-08-23,
 * Europe/Berlin day 2026-08-24 (measured 2026-09-04).
 *
 * Every call site that buckets a `timestamptz` column into a `day` label,
 * or snaps a window's lower bound to a day boundary, for any table in this
 * family must go through the two exports below — not spell out its own
 * `to_char(...)` / `date_trunc(...)` literal. That is what makes "day
 * means UTC" a class property instead of three independently-typed copies
 * that can silently drift to three different answers.
 */

/**
 * SQL fragment that buckets a timestamptz-valued `column` expression into
 * its UTC calendar day, as a `'YYYY-MM-DD'` text label. `column` is
 * interpolated as raw SQL text (a column reference or cast expression, e.g.
 * `"received_at"` or `"s.created_at::timestamptz"`), never a query
 * parameter — same trust boundary as any other SQL-builder in this
 * codebase (`buildUpsert`): callers pass identifiers/expressions they wrote
 * themselves, never user input.
 */
export function utcDayColumnSql(column: string): string {
  return `to_char(${column} at time zone 'utc', 'YYYY-MM-DD')`;
}

/**
 * SQL fragment snapping to the start of the current UTC calendar day —
 * the lower-bound anchor for a trailing N-day window. The three-arg
 * `date_trunc(..., 'UTC')` form is required, not `now() at time zone
 * 'utc'`: the latter returns a NAIVE timestamp that gets compared in the
 * session's own timezone, silently reintroducing a multi-hour version of
 * this exact bug for window bounds instead of day labels.
 */
export const UTC_DAY_TRUNC_NOW_SQL = `date_trunc('day', now(), 'UTC')`;
