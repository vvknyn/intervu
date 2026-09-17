/**
 * Server-side PostHog capture — for events a client-side `captureEvent`
 * (lib/analytics/events.ts) cannot reliably send, because the browser never
 * gets a chance to run before the request that decides the event's outcome
 * completes. `search_alert_submitted`/`search_alert_verified` are exactly
 * this: the verify link is a bare GET that 302s straight into `/jobs`, so a
 * client-side capture racing that redirect is how PostHog showed
 * `search_alert_impressed` firing but `search_alert_submitted` and
 * `search_alert_verified` never following through (30d: 76 / 0 / 0).
 *
 * Posts straight to PostHog's HTTP capture API rather than adding
 * `posthog-node` — this is the only server-side event this repo sends, and
 * a plain `fetch` (the PostHog project key is a public, write-only key, safe
 * to hold in a `NEXT_PUBLIC_*` env var and reuse here — see
 * `PostHogProvider.tsx`) covers it without a new dependency. Reuses
 * `posthogApiHost` (posthog-options.ts) so this rides the SAME same-origin
 * proxy the client SDK already depends on, rather than a second, divergent
 * idea of where PostHog lives.
 *
 * Fire-and-forget by construction: analytics must never fail or delay the
 * request it's attached to. No-ops (issues no fetch at all) when
 * `NEXT_PUBLIC_POSTHOG_KEY` is unset, same as the client SDK's own guard
 * (`shouldCaptureEvent`, events.ts) — and never throws, so a route handler
 * never needs to wrap this in its own try/catch.
 */
import { ANALYTICS_EVENTS, type AnalyticsEventKey } from "@/lib/analytics/event-names";
import type { EventPayloads } from "@/lib/analytics/events";
import { posthogApiHost } from "@/lib/posthog-options";
import { getSiteUrl } from "@/lib/seo/constants";

export function captureServerEvent<K extends AnalyticsEventKey>(
  event: K,
  distinctId: string,
  properties: EventPayloads[K],
): void {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  let apiHost: string;
  try {
    apiHost = posthogApiHost(getSiteUrl(), process.env.NEXT_PUBLIC_POSTHOG_HOST);
  } catch {
    return;
  }

  fetch(`${apiHost}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: ANALYTICS_EVENTS[event],
      properties: { ...properties, distinct_id: distinctId },
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {
    // Fire-and-forget — a dead analytics endpoint must never surface as a
    // failure of the request that triggered the capture.
  });
}
