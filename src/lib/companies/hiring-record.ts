import type { CompanyExhaust, IntegrityFacts } from "./exhaust";

/**
 * Pure helpers for the employer's opened/closed record. Kept apart from
 * exhaust.ts, which imports the Postgres pool, because presentation.ts reads
 * them and presentation.ts is imported by client components.
 */

/** Weeks in the opened/closed record and the cadence strip under it: week-aligned,
 *  this (in-progress) week included. The strip sits in the page's 320px rail. */
export const RECORD_WINDOW_WEEKS = 13;

/** ISO week (Monday-start) containing `ms`, as a UTC-midnight `YYYY-MM-DD`. */
export function isoWeekStart(ms: number): string {
  const d = new Date(ms);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday))
    .toISOString()
    .slice(0, 10);
}

/**
 * Whether Velai started tracking the employer inside the record window — the
 * one test deciding the sentence's "Tracked since" form, the strip's backlog
 * bar and whether "Watched since" repeats the start.
 */
export function trackingStartedInWindow(trackedSinceIso: string | null | undefined, nowMs: number): boolean {
  const trackedMs = trackedSinceIso ? Date.parse(trackedSinceIso) : NaN;
  if (Number.isNaN(trackedMs)) return false;
  return isoWeekStart(trackedMs) >= isoWeekStart(nowMs - (RECORD_WINDOW_WEEKS - 1) * 7 * 86_400_000);
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
 * `job_listings` — the only place the page states it.
 *
 * When Velai started tracking the employer inside the window, a "last 13
 * weeks" sentence would present a partial window as a full one, so it names
 * the start instead. The opened count never includes the first tracked week
 * (see `IntegrityFacts.openedCount`).
 */
export function hiringRecordSentence(facts: IntegrityFacts, nowMs: number): string {
  const closed = facts.closedReasonCounts.reduce((sum, r) => sum + r.count, 0);
  const opened = facts.openedCount;
  const roles = (n: number) => `${n} role${n === 1 ? "" : "s"}`;
  if (trackingStartedInWindow(facts.trackedSinceIso, nowMs)) {
    const week = formatUtcDate(`${isoWeekStart(Date.parse(facts.trackedSinceIso as string))}T00:00:00Z`);
    return `Tracked since the week of ${week}: ${roles(opened)} opened after that first week, ${closed} closed.`;
  }
  return `Last ${RECORD_WINDOW_WEEKS} weeks: ${roles(opened)} opened, ${closed} closed.`;
}

/**
 * The record sentence for an employer's box read, or null when the integrity
 * facts are missing. Every surface that states the record goes through this,
 * so a missing read shows no line and nothing else can stand in for it.
 */
export function exhaustHiringRecord(exhaust: CompanyExhaust | null | undefined, nowMs: number): string | null {
  return exhaust?.integrity ? hiringRecordSentence(exhaust.integrity.data, nowMs) : null;
}
