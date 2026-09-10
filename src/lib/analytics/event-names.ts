/**
 * The single declaration of the telemetry wire-name vocabulary. Every event
 * name this product ever emits is decided here, once — nowhere else.
 *
 * Deliberately zero imports: this is a pure leaf module so both sides of the
 * client/server split can depend on it without either depending on the
 * other. `src/lib/analytics/events.ts` (browser-side, imports posthog-js)
 * re-exports this map for its 18 existing client callers, and
 * `src/lib/telemetry/outcome-events.ts` (server/script-side rollup code)
 * derives its own constants from it — neither file imports the other, and
 * neither can drift from this one.
 */
export const ANALYTICS_EVENTS = {
  // Original wave-3 six — wire names are a dashboard contract, never rename.
  search_submitted: "search_submitted",
  result_clicked: "result_clicked",
  apply_clicked: "apply_clicked",
  job_saved: "job_saved",
  company_followed: "company_followed",
  auth_started: "auth_started",
  signup_completed: "signup_completed",

  // Job entity
  job_viewed: "job_viewed",
  job_unsaved: "job_unsaved",
  job_marked_applied: "job_marked_applied",
  // Wire name kept as the pre-existing "share_initiated" (previously sent by
  // the untyped `trackEvent` in lib/analytics.ts) so this doesn't fork an
  // existing dashboard metric in two — job-surface shares now carry job_id.
  job_shared: "share_initiated",
  job_match_expanded: "job_match_expanded",

  // Company entity
  company_viewed: "company_viewed",
  company_unfollowed: "company_unfollowed",

  // Search / SERP
  search_zero_results: "search_zero_results",
  search_filter_applied: "search_filter_applied",
  search_results_paged: "search_results_paged",
  results_impressed: "results_impressed",

  search_alert_impressed: "search_alert_impressed",
  search_alert_submitted: "search_alert_submitted",
  search_alert_verified: "search_alert_verified",
  search_alert_dismissed: "search_alert_dismissed",

  // Application tracker
  application_stage_changed: "application_stage_changed",
  resume_uploaded: "resume_uploaded",
} as const;

export type AnalyticsEventKey = keyof typeof ANALYTICS_EVENTS;

/** How the account was created — the `method` on `signup_completed`. */
export type SignupMethod = "email" | "google" | "username" | "passkey";
