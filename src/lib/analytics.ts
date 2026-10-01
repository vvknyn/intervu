import { getPostHogClient } from "@/lib/analytics/posthog-client";

// Thin wrapper, ported from subspace (interview-os/src/lib/analytics.ts).
// No-ops until PostHogProvider has initialized PostHog (never, when
// NEXT_PUBLIC_POSTHOG_KEY is unset): see posthog-client.ts.
// Nothing calls this yet in this PR: autocapture + pageviews only, event
// taxonomy is a later, deliberate pass.
export function trackEvent(event: string, properties?: Record<string, any>) {
  if (typeof window === "undefined") return;
  getPostHogClient()?.capture(event, properties);
}
