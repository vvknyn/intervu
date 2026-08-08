import posthog from "posthog-js";

// Thin wrapper, ported from subspace (interview-os/src/lib/analytics.ts).
// No-ops with PostHogProvider when NEXT_PUBLIC_POSTHOG_KEY is unset —
// posthog.capture() is a no-op before posthog.init() runs.
// Nothing calls this yet in this PR: autocapture + pageviews only, event
// taxonomy is a later, deliberate pass.
export function trackEvent(event: string, properties?: Record<string, any>) {
  if (typeof window === "undefined") return;
  posthog.capture(event, properties);
}
