import type { PostHogConfig } from "posthog-js";

/**
 * What intervu tells PostHog at init.
 *
 * Split out from PostHogProvider so the *decision* (what we collect, and what
 * we deliberately don't) is reviewable and testable without booting React or
 * the posthog-js runtime. tests/unit/posthog-options.test.ts pins the values
 * that have silently broken analytics before — see the notes on each.
 *
 * `api_host` is decided here too (see posthogApiHost) — where analytics is
 * *sent* turned out to be a data-loss decision, not a deployment detail.
 */

/**
 * Stamped on every event via posthog.register() right after init — this, plus
 * the automatic $host, is how intervu's events are told apart from subspace's
 * inside the one shared PostHog project.
 */
export const POSTHOG_PRODUCT = "intervu";

/**
 * Analytics is served from intervu's own origin instead of PostHog's domains.
 *
 * Two separate losses made the direct setup bleed data with nothing to see:
 *
 * 1. `us.i.posthog.com` is on EasyPrivacy, uBlock Origin, Brave and AdGuard
 *    lists. A blocked visitor produces no request, no console error and no
 *    server-side trace — the events never leave the browser. The shortfall is
 *    therefore invisible from every dashboard we own, which is why it reads as
 *    "roughly half the traffic" rather than as an outage.
 *
 * 2. Session replay ships from a DIFFERENT host. posthog-js derives `region`
 *    from `api_host`, and a US region sends static assets — including the
 *    lazily-fetched rrweb recorder — to `us-assets.i.posthog.com` while events
 *    go to `us.i.posthog.com` (`utils/request-router.ts`, the `assets` branch).
 *    Losing either host alone drops recordings while events keep arriving,
 *    which is exactly how "half the replays are missing" presents.
 *
 * Pointing `api_host` at our own origin makes `region` CUSTOM, and CUSTOM
 * routes BOTH events and assets through this single path — so one proxy rule
 * covers what were two third-party domains. It also keeps the app's own
 * `script-src 'self'` CSP (report-only today, `next.config.ts`) valid if it is
 * ever enforced, which the direct setup would not survive.
 *
 * ⚠️ The other half of this lives in a DIFFERENT REPO: the Caddy rule that
 * forwards `/ph/*` sits in interview-os (`deploy/contabo-web/Caddyfile`), so no
 * test here can hold the two together. Without that rule these requests 404 and
 * analytics is silently dead — the same invisible failure this replaced. If you
 * change this path, change the Caddyfile in the same breath and re-check
 * `curl -o /dev/null -w '%{http_code}' https://intervuhq.com/ph/static/recorder.js`
 * (200 = wired, 404 = analytics is off).
 */
export const POSTHOG_PROXY_PATH = "/ph";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Where posthog-js sends events, replays and asset requests.
 *
 * The same-origin proxy is the DEFAULT rather than something env has to opt
 * into: an unset or dropped `NEXT_PUBLIC_POSTHOG_HOST` must not quietly
 * restore the blocked third-party host this whole change exists to leave. The
 * override stays for debugging and for any deploy that has no proxy in front
 * of it — an explicit choice, never a fallback.
 *
 * `origin` is a parameter rather than a `window.location` read so the decision
 * is a pure function, testable without a DOM.
 */
export function posthogApiHost(
  origin: string,
  override?: string | null,
): string {
  const explicit = override?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  return `${stripTrailingSlash(origin)}${POSTHOG_PROXY_PATH}`;
}

export const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
  // Guests stay unprofiled; a person profile is created only once
  // PostHogProvider calls identify() on sign-in.
  person_profiles: "identified_only",

  // MUST be the string "history_change", never `true`.
  //
  // posthog-js gates its History-API monitor on a strict
  // `"history_change" === config.capture_pageview` check, so the
  // truthy-but-wrong `true` silently selects the legacy init-only mode: one
  // $pageview per hard page load and nothing at all for client-side
  // navigation. intervu is an App Router SPA, so under `true` every in-app
  // route change (/jobs -> /co/[slug] -> /pricing) was invisible.
  //
  // The monitor dedupes on pathname, so this neither double-counts the initial
  // pageview nor fires on query-only changes (/jobs?q=... filter edits).
  capture_pageview: "history_change",

  capture_pageleave: true,
  autocapture: true,

  // Needed *because* api_host is now our own origin.
  //
  // posthog-js derives the UI host by string-replacing the ingestion subdomain
  // out of api_host (`request-router.ts`, the `uiHost` getter). That rewrite
  // assumes a posthog.com address; against "https://intervuhq.com/ph" it
  // matches nothing and hands the toolbar and every "view in PostHog" link a
  // URL pointing back at us. Naming the real UI host keeps those working.
  ui_host: "https://us.posthog.com",

  // Cookieless, per-tab, gone on reload.
  //
  // This is a PUBLISHED PROMISE, not a tuning knob: /privacy states "It runs
  // cookieless on intervu: no analytics cookie is set, and session state is
  // kept in memory only, gone the moment you close the tab or reload."
  // Changing it would make that page false. The known cost is that a hard
  // reload starts a fresh anonymous id, so unique-visitor and
  // returning-visitor counts read high; that trade was made on purpose.
  persistence: "memory",
};
