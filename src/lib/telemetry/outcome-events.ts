/**
 * Wire-name classification for the rollup's read of
 * `intervu.telemetry_events.event_name`.
 *
 * The event-NAME vocabulary is owned by `src/lib/analytics/events.ts`
 * (`ANALYTICS_EVENTS`) — this module deliberately does NOT import it. That
 * file does `import posthog from "posthog-js"` at module scope (a
 * browser-oriented SDK), which is unsafe to pull into a Node cron process.
 * The four wire-name strings below are copied from that file's
 * `ANALYTICS_EVENTS` values as of 2026-09-03; if that file ever renames one
 * of these four events, this module's tests will keep passing against a now
 * meaning stale string — a case a code owner must catch on review of any
 * future edit to `events.ts`, since a duplicated literal cannot detect a
 * rename in its source of truth by itself. Single source of truth for the
 * DERIVED-layer's OWN vocabulary (job_daily/company_daily/feature_outcomes
 * outcome classification) is this file, not a second copy per rollup.
 */

// No "dismissal" member: no wire event for dismissing a job result exists
// anywhere in ANALYTICS_EVENTS today (only `search_alert_dismissed`, a
// different entity) — `job_daily.dismissals` is therefore a real,
// currently-empty count computed elsewhere (daily-rollup.ts), not a case
// this classifier is missing.
export type OutcomeKind = "impression" | "click" | "apply" | "save";

// Wire names, copied from ANALYTICS_EVENTS in src/lib/analytics/events.ts.
const RESULTS_IMPRESSED = "results_impressed";
const RESULT_CLICKED = "result_clicked";
const APPLY_CLICKED = "apply_clicked";
const JOB_SAVED = "job_saved";

/**
 * Classifies one ledger row's `event_name` into an outcome kind, or null
 * when the event isn't one the derived layer counts (e.g. `job_viewed`,
 * `search_submitted`). No "dismiss" wire event exists for job results today
 * (only `search_alert_dismissed`, a different entity) — `dismissal` is a
 * real, currently-empty category, not a name mapped here in anticipation of
 * one.
 */
export function classifyOutcomeEvent(eventName: string): OutcomeKind | null {
  switch (eventName) {
    case RESULTS_IMPRESSED:
      return "impression";
    case RESULT_CLICKED:
      return "click";
    case APPLY_CLICKED:
      return "apply";
    case JOB_SAVED:
      return "save";
    default:
      return null;
  }
}
