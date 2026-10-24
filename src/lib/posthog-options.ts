import type { CaptureResult, PostHogConfig } from "posthog-js";

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
 * `curl -o /dev/null -w '%{http_code}' https://velai.app/ph/static/recorder.js`
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

/**
 * A page or link address without the words searched. Velai keeps a search's
 * text only in its anonymous search log (lib/jobs/search-log.ts); analytics
 * are tied to a signed-in account, so every address they carry loses `q`:
 * what was typed, or the résumé's own role titles under Rank by fit
 * (`sort=fit`). Absolute and site-relative addresses are handled; anything
 * else comes back unchanged.
 */
export function withoutSearchTerms(value: string): string {
  if (!value.includes("q=")) return value;
  const absolute = /^https?:\/\//.test(value);
  if (!absolute && !value.startsWith("/")) return value;
  try {
    const url = new URL(value, "https://velai.app");
    if (!url.searchParams.has("q")) return value;
    url.searchParams.delete("q");
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

/** A click's `$elements_chain` (`a:href="/jobs?q=nurse"...`) with each link's address searched-word free. */
function elementsChainWithoutSearchTerms(chain: string): string {
  return chain.replace(/(href|attr__href)="([^"]*)"/g, (_match, attr: string, href: string) => `${attr}="${withoutSearchTerms(href)}"`);
}

/** `before_send`: every address an event carries, person `$set`s and clicked links included, without the words searched. */
export function stripSearchTerms(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const [key, value] of Object.entries(bag)) {
      if (key === "$elements_chain" && typeof value === "string") bag[key] = elementsChainWithoutSearchTerms(value);
      else if (typeof value === "string") bag[key] = withoutSearchTerms(value);
      else if (key === "$elements" && Array.isArray(value)) {
        for (const element of value as Record<string, unknown>[]) {
          for (const attr of ["attr__href", "href"]) {
            if (typeof element?.[attr] === "string") element[attr] = withoutSearchTerms(element[attr] as string);
          }
        }
      }
    }
  }
  return event;
}

export const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
  // Analytics are anonymous: no person profile is ever created, and nothing
  // calls identify().
  person_profiles: "never",

  // MUST be the string "history_change", never `true`.
  //
  // posthog-js gates its History-API monitor on a strict
  // `"history_change" === config.capture_pageview` check, so the
  // truthy-but-wrong `true` silently selects the legacy init-only mode: one
  // $pageview per hard page load and nothing at all for client-side
  // navigation. intervu is an App Router SPA, so under `true` every in-app
  // route change (/jobs -> /co/[slug] -> /trends) was invisible.
  //
  // The monitor dedupes on pathname, so this neither double-counts the initial
  // pageview nor fires on query-only changes (/jobs?q=... filter edits).
  capture_pageview: "history_change",

  capture_pageleave: true,

  // No autocapture: a click would record which element it was, and the
  // anonymous promise on /privacy is that only named events are sent.
  autocapture: false,

  // Heatmaps would record click positions: off.
  enable_heatmaps: false,

  // No session replay, whatever the PostHog project setting says.
  disable_session_recording: true,

  // No exception capture: an error message can embed text the user typed, and
  // before_send only rewrites addresses.
  capture_exceptions: false,

  // No surveys on any viewport: a survey response is free text and may be an
  // email address.
  disable_surveys: true,

  // Needed *because* api_host is now our own origin.
  //
  // posthog-js derives the UI host by string-replacing the ingestion subdomain
  // out of api_host (`request-router.ts`, the `uiHost` getter). That rewrite
  // assumes a posthog.com address; against "https://velai.app/ph" it
  // matches nothing and hands the toolbar and every "view in PostHog" link a
  // URL pointing back at us. Naming the real UI host keeps those working.
  ui_host: "https://us.posthog.com",

  // The last stop before an event leaves the browser: no résumé role titles in any address.
  before_send: stripSearchTerms,

  // Cookieless, per-tab, gone when the tab closes.
  //
  // This is a PUBLISHED PROMISE, not a tuning knob — /privacy describes
  // exactly this behaviour, and tests/unit/posthog-options.test.ts looks up
  // the required wording BY the mode set here, so the two cannot drift.
  //
  // Why not "memory": posthog-js treats memory persistence as "cannot use
  // session storage" (sessionid.ts `_canUseSessionStorage`), so the session id
  // is reborn on every reload and every in-tab navigation that isn't a client
  // route change. Session replays arrive chopped into one-page fragments and
  // any funnel spanning a reload cannot connect. That was the cost of the
  // stricter setting, and it was being paid in full.
  //
  // Why not "localStorage+cookie" (posthog-js's default): that survives
  // closing the tab, which is cross-visit tracking and needs a consent
  // banner intervu does not have. sessionStorage is the narrowest setting
  // that makes a single visit legible: no cookie, nothing shared between
  // tabs, nothing left behind once the tab is closed. Returning-visitor and
  // unique-visitor counts still read high, and that trade stands.
  persistence: "sessionStorage",
};
