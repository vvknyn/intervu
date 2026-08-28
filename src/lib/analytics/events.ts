import posthog from "posthog-js";

/**
 * Wave-2 package F wired up the first six wire names (search → apply →
 * save/follow → signup). This module generalizes that same catalog to every
 * user action worth a funnel: job/company detail views, saves, shares,
 * search refinement, and application-stage moves. See docs/analytics/EVENTS.md
 * for the full taxonomy — event, payload, seam file, metric it feeds.
 *
 * ANALYTICS_EVENTS is the one place an event's wire name is decided. Every
 * caller reaches a name through captureEvent's `K` type parameter rather
 * than typing the string directly, so a rename can't land in one call site
 * and not another.
 *
 * Does NOT call posthog.register({ product }) — PostHogProvider already
 * stamps that super-property once, right after init(); doing it again here
 * would just re-set the same value on every capture.
 */

export const ANALYTICS_EVENTS = {
  // Original wave-3 six — wire names are a dashboard contract, never rename.
  search_submitted: "search_submitted",
  result_clicked: "result_clicked",
  apply_clicked: "apply_clicked",
  job_saved: "job_saved",
  company_followed: "company_followed",
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

  // Application tracker
  application_stage_changed: "application_stage_changed",
  resume_uploaded: "resume_uploaded",
} as const;

export type AnalyticsEventKey = keyof typeof ANALYTICS_EVENTS;

/** Where a job result/apply/view/share originated. */
export type EventSource = "serp" | "co" | "board" | "email" | "direct";

export interface EventPayloads {
  search_submitted: {
    query_length: number;
    has_location: boolean;
    filter_count: number;
  };
  result_clicked: {
    position: number;
    job_id: string;
    source: EventSource;
  };
  apply_clicked: {
    job_id: string;
    source: EventSource;
  };
  job_saved: {
    job_id: string;
  };
  company_followed: {
    company_domain: string;
  };
  signup_completed: {
    method: "email" | "google" | "username";
  };

  job_viewed: {
    job_id: string;
    company_domain: string | null;
    source: EventSource;
  };
  job_unsaved: {
    job_id: string;
  };
  job_marked_applied: {
    job_id: string;
  };
  job_shared: {
    job_id: string;
    method: "native" | "clipboard";
  };
  job_match_expanded: {
    job_id: string;
  };

  company_viewed: {
    company_domain: string;
  };
  company_unfollowed: {
    company_domain: string;
  };

  search_zero_results: {
    query_length: number;
    filter_count: number;
  };
  search_filter_applied: {
    facet: string;
  };
  search_results_paged: {
    depth: number;
  };
  results_impressed: {
    job_ids: string[];
    count: number;
    source: EventSource;
  };

  application_stage_changed: {
    job_id: string;
    from_stage: string;
    to_stage: string;
  };
  resume_uploaded: Record<string, never>;
}

/**
 * Pure: should this call actually reach PostHog? Kept separate from the I/O
 * below — same pure-decision/thin-I/O split posthog-identity.ts uses for
 * identityAction — so the guard is testable without a DOM or a mocked
 * posthog-js.
 */
export function shouldCaptureEvent(hasWindow: boolean, loaded: boolean): boolean {
  return hasWindow && loaded;
}

/**
 * The only I/O in this module. Typed via EventPayloads so a call site that
 * gets an event's payload shape wrong fails to compile.
 *
 * Mirrors PostHogProvider's own guard: SSR-safe (`typeof window ===
 * "undefined"`), and a safe no-op when PostHog was never initialized (no
 * NEXT_PUBLIC_POSTHOG_KEY -> posthog.init() never ran -> posthog.__loaded
 * stays false) — no throw, no console spam beyond whatever posthog-js does
 * internally.
 */
export function captureEvent<K extends AnalyticsEventKey>(
  event: K,
  payload: EventPayloads[K],
): void {
  const hasWindow = typeof window !== "undefined";
  if (!shouldCaptureEvent(hasWindow, posthog.__loaded === true)) return;
  posthog.capture(ANALYTICS_EVENTS[event], payload);
}
