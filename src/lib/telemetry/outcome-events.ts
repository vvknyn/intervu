import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";

/**
 * Wire-name classification for the rollup's read of
 * `intervu.telemetry_events.event_name`.
 *
 * The event-NAME vocabulary is owned by `src/lib/analytics/event-names.ts`
 * (`ANALYTICS_EVENTS`) — a dependency-free leaf module, safe to import from
 * a Node cron process. (`src/lib/analytics/events.ts`, the browser-side
 * emitter, does `import posthog from "posthog-js"` at module scope and is
 * NOT imported here for that reason — it re-exports the same map instead.)
 * Single source of truth for the DERIVED-layer's OWN vocabulary
 * (job_daily/company_daily/feature_outcomes outcome classification) is this
 * file, not a second copy per rollup.
 */

// No "dismissal" member: no wire event for dismissing a job result exists
// anywhere in ANALYTICS_EVENTS today (only `search_alert_dismissed`, a
// different entity) — `job_daily.dismissals` is therefore a real,
// currently-empty count computed elsewhere (daily-rollup.ts), not a case
// this classifier is missing.
export type OutcomeKind = "impression" | "click" | "apply" | "save";

// Wire names, derived from ANALYTICS_EVENTS in src/lib/analytics/event-names.ts.
// All four are exported: any consumer that has to stamp or match one of
// these exact wire names (e.g. src/lib/telemetry/rollup-fetch.ts's
// impression-array unnest, which both filters SQL on RESULTS_IMPRESSED and
// stamps it onto synthetic rows) imports the constant. Re-typing any of
// these literals at a call site would be a second, driftable copy of the
// same wire-name fact — a ratchet test (tests/unit/roll-up-telemetry-event-
// name-ratchet.test.ts) fails if one shows up hardcoded anywhere under
// src/lib/telemetry/ or scripts/.
export const RESULTS_IMPRESSED = ANALYTICS_EVENTS.results_impressed;
export const RESULT_CLICKED = ANALYTICS_EVENTS.result_clicked;
export const APPLY_CLICKED = ANALYTICS_EVENTS.apply_clicked;
export const JOB_SAVED = ANALYTICS_EVENTS.job_saved;

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
