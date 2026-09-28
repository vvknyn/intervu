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
 * `posthog-node`. Search-alert events and `$ai_generation` (see
 * `ai-generation.ts`) both go through `postServerCapture`. A plain `fetch`
 * (the PostHog project key is a public, write-only key, safe
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
 *
 * Stamps `$host` (the bare hostname of `getSiteUrl()`) and `$lib:
 * "velai-server"` on every event: this goes out over a raw `fetch`, not the
 * posthog-js browser SDK, so none of the SDK's automatic properties —
 * `$host` included — are attached for free. Dashboards filter on
 * `$host === "velai.app"`, so without it these events exist in PostHog but
 * never surface on any dashboard built that way.
 */
import { ANALYTICS_EVENTS, type AnalyticsEventKey } from "@/lib/analytics/event-names";
import type { EventPayloads } from "@/lib/analytics/events";
import { posthogApiHost } from "@/lib/posthog-options";
import { getSiteUrl } from "@/lib/seo/constants";

export function postServerCapture(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): void {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  let apiHost: string;
  let siteHost: string;
  try {
    const siteUrl = getSiteUrl();
    apiHost = posthogApiHost(siteUrl, process.env.NEXT_PUBLIC_POSTHOG_HOST);
    siteHost = new URL(siteUrl).hostname;
  } catch {
    return;
  }

  fetch(`${apiHost}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      // $host and $lib are appended last so caller-supplied `properties`
      // can never override them — see the module doc: dashboards filter on
      // `$host`, and the browser SDK sets it automatically, but a raw
      // server-side `fetch` carries no request context to derive it from.
      properties: { ...properties, distinct_id: distinctId, $host: siteHost, $lib: "velai-server" },
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {
    // Fire-and-forget — a dead analytics endpoint must never surface as a
    // failure of the request that triggered the capture.
  });
}

export function captureServerEvent<K extends AnalyticsEventKey>(
  event: K,
  distinctId: string,
  properties: EventPayloads[K],
): void {
  postServerCapture(ANALYTICS_EVENTS[event], distinctId, properties as Record<string, unknown>);
}
