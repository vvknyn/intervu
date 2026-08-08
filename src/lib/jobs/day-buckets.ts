/**
 * Pure UTC calendar-day boundary math — shared by /trends' 14-day posted
 * series (market-trends.ts) and the daily snapshot doc-id convention
 * (lib/trends/daily-snapshot.ts), so both agree on where one day ends and
 * the next begins regardless of the server process's local timezone or DST.
 *
 * Deliberately `Date.UTC` throughout, never the local-time `new Date(y, m,
 * d)` constructor: local-time day arithmetic shifts by daylight-saving
 * transitions in whatever TZ the runtime happens to be in (a "day" can come
 * out 23h or 25h long around a DST change), while `Date.UTC` has no DST
 * concept at all — every day here is always exactly 86,400,000ms.
 *
 * Pure, DOM-free — unit-testable without a network call.
 */

export const DAY_MS = 86_400_000;

export interface UtcDayRange {
  startMs: number;
  endMs: number;
  /** YYYY-MM-DD, UTC. */
  dateLabel: string;
}

/** The UTC calendar day `daysAgo` days before `nowMs` (0 = today, UTC). */
export function utcDayRange(nowMs: number, daysAgo: number): UtcDayRange {
  const d = new Date(nowMs);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysAgo * DAY_MS;
  return { startMs, endMs: startMs + DAY_MS, dateLabel: new Date(startMs).toISOString().slice(0, 10) };
}

/** The last 14 UTC calendar days including today, oldest first — the
 *  posted-per-day series' bucket list (market-trends.ts). */
export function last14UtcDays(nowMs: number): UtcDayRange[] {
  return Array.from({ length: 14 }, (_, i) => utcDayRange(nowMs, 13 - i));
}

/** Today's UTC date label — the daily-snapshot doc-id convention
 *  (`market_stats_daily/<YYYY-MM-DD UTC>`, daily-snapshot.ts). */
export function todayUtcDateLabel(nowMs: number): string {
  return utcDayRange(nowMs, 0).dateLabel;
}
