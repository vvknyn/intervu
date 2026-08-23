import posthog from "posthog-js";

/**
 * Wave-2 package F: stable funnel-event names, and a thin typed wrapper over
 * the posthog-js singleton PostHogProvider already initializes.
 *
 * This module defines the naming CONTRACT wave-3 wires up against — it has
 * zero call sites of its own (see docs/analytics/FUNNEL.md for where each
 * event is meant to be called from).
 *
 * FUNNEL_EVENTS is the one place an event's wire name is decided. Every
 * caller reaches a name through captureFunnelEvent's `K` type parameter
 * rather than typing the string directly, so a rename can't land in one call
 * site and not another.
 *
 * Does NOT call posthog.register({ product }) — PostHogProvider already
 * stamps that super-property once, right after init(); doing it again here
 * would just re-set the same value on every capture.
 */

export const FUNNEL_EVENTS = {
  search_submitted: "search_submitted",
  result_clicked: "result_clicked",
  apply_clicked: "apply_clicked",
  job_saved: "job_saved",
  company_followed: "company_followed",
  signup_completed: "signup_completed",
} as const;

export type FunnelEventKey = keyof typeof FUNNEL_EVENTS;

/** Where a job result/apply click originated. */
export type FunnelResultSource = "serp" | "co" | "email";

export interface FunnelEventPayloads {
  search_submitted: {
    query_length: number;
    has_location: boolean;
    filter_count: number;
  };
  result_clicked: {
    position: number;
    job_id: string;
    source: FunnelResultSource;
  };
  apply_clicked: {
    job_id: string;
    source: FunnelResultSource;
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
}

/**
 * Pure: should this call actually reach PostHog? Kept separate from the I/O
 * below — same pure-decision/thin-I/O split posthog-identity.ts uses for
 * identityAction — so the guard is testable without a DOM or a mocked
 * posthog-js.
 */
export function shouldCaptureFunnelEvent(hasWindow: boolean, loaded: boolean): boolean {
  return hasWindow && loaded;
}

/**
 * The only I/O in this module. Typed via FunnelEventPayloads so a call site
 * that gets an event's payload shape wrong fails to compile.
 *
 * Mirrors PostHogProvider's own guard: SSR-safe (`typeof window ===
 * "undefined"`), and a safe no-op when PostHog was never initialized (no
 * NEXT_PUBLIC_POSTHOG_KEY -> posthog.init() never ran -> posthog.__loaded
 * stays false) — no throw, no console spam beyond whatever posthog-js does
 * internally.
 */
export function captureFunnelEvent<K extends FunnelEventKey>(
  event: K,
  payload: FunnelEventPayloads[K],
): void {
  const hasWindow = typeof window !== "undefined";
  if (!shouldCaptureFunnelEvent(hasWindow, posthog.__loaded === true)) return;
  posthog.capture(FUNNEL_EVENTS[event], payload);
}
