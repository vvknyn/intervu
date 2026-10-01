import type { IntegrityFacts } from "./exhaust";

/**
 * Pure helpers for the employer's opened/closed record. Kept apart from
 * exhaust.ts, which imports the Postgres pool, because presentation.ts reads
 * them and presentation.ts is imported by client components.
 */

/** Trailing window, in days, of the opened/closed record. */
export const INTEGRITY_WINDOW_DAYS = 90;

/** ISO week (Monday-start) containing `ms`, as a UTC-midnight `YYYY-MM-DD`. */
export function isoWeekStart(ms: number): string {
  const d = new Date(ms);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday))
    .toISOString()
    .slice(0, 10);
}

function formatUtcDate(iso: string): string {
  return new Date(Date.parse(iso)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The one sentence for the employer's recent opened/closed record, read from
 * `job_listings` — shared by the rail's hiring record and the integrity band
 * so the two can never make opposite claims about the same window.
 *
 * When Velai started tracking the employer inside the 90-day window, a "last
 * 90 days" sentence would present a partial window as a full one, so it names
 * the start instead. The opened count never includes the first tracked week
 * (see `IntegrityFacts.openedCount`).
 */
export function hiringRecordSentence(facts: IntegrityFacts, nowMs: number): string {
  const closed = facts.closedReasonCounts.reduce((sum, r) => sum + r.count, 0);
  const opened = facts.openedCount;
  const roles = (n: number) => `${n} role${n === 1 ? "" : "s"}`;
  const trackedMs = facts.trackedSinceIso ? Date.parse(facts.trackedSinceIso) : NaN;
  const windowMs = INTEGRITY_WINDOW_DAYS * 86_400_000;
  if (!Number.isNaN(trackedMs) && nowMs - trackedMs < windowMs) {
    const week = formatUtcDate(`${isoWeekStart(trackedMs)}T00:00:00Z`);
    return `Tracked since the week of ${week}: ${roles(opened)} opened after that first week, ${closed} closed.`;
  }
  return `Last ${INTEGRITY_WINDOW_DAYS} days: ${roles(opened)} opened, ${closed} closed.`;
}
