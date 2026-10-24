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
 * A page or link address with no query string and no hash. A query can carry
 * the words searched (`?q=`), the résumé's role titles (`sort=fit`), a nested
 * copy of either (`/login?next=%2Fjobs%3Fq%3D...`) or a bearer token
 * (`?token=`), and a hash can carry the same. None of it is needed for
 * analytics, so every address loses both, whatever the key. Absolute and
 * site-relative addresses are handled; anything else comes back unchanged.
 */
export function withoutQueryAndHash(value: string): string {
  if (!/[?#]/.test(value)) return value;
  const absolute = /^https?:\/\//i.test(value);
  if (!absolute && !(value.startsWith("/") && !value.startsWith("//"))) return value;
  try {
    const url = new URL(value, "https://velai.app");
    url.search = "";
    url.hash = "";
    return absolute ? url.toString() : url.pathname;
  } catch {
    return value;
  }
}

/** A string property: each link inside a click's `$elements_chain` (`a:href="/jobs?q=nurse"...`) cleaned, then the whole value if it is itself an address. */
function scrubString(value: string): string {
  const chain = value.includes('href="')
    ? value.replace(/(href|attr__href)="([^"]*)"/g, (_match, attr: string, href: string) => `${attr}="${withoutQueryAndHash(href)}"`)
    : value;
  return withoutQueryAndHash(chain);
}

/** Strings anywhere in a property value, arrays (`$elements`) and nested objects included. */
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, scrubValue(inner)]));
  }
  return value;
}

/**
 * Properties that say where a visitor came from or which campaign link they
 * followed. /privacy promises none of it is kept. Dropped by key class, not by
 * a list of names:
 * - anything naming a referrer (`$referrer`, `$referring_domain`, `$initial_referrer`, ...);
 * - `utm_*` tags and the search-engine / search-keyword pair posthog-js reads
 *   from the referrer (`$search_engine`, `ph_keyword`);
 * - every `$initial_*` and `$session_entry_*` property. posthog-js builds those
 *   from the first page address and referrer (`session-props.js`
 *   generateSessionSourceParams, `event-utils.js` getPersonPropsFromInfo) and
 *   no config switch turns the session-entry copy off, so this is the only stop
 *   for them, ad click ids (`gclid`, `fbclid`, ...) included.
 */
const ATTRIBUTION_KEY = /referr|^utm_|^\$search_engine$|^ph_keyword$|^\$(initial|session_entry)_/i;

/** `before_send`: every address an event carries, person `$set`s and clicked links included, without query string or hash; and no referrer, campaign tag or click id. */
export function stripUrlQueries(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const [key, value] of Object.entries(bag)) {
      if (ATTRIBUTION_KEY.test(key)) delete bag[key];
      else bag[key] = scrubValue(value);
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

  // Every other capture lane posthog-js 1.414 can start, pinned off here
  // because the PostHog project is SHARED with Subspace and its remote config
  // can switch lanes on for every Velai browser. Where the remote value
  // ignores a client `false` (console logs, web vitals, conversations), the
  // lazy-loaded bundle is blocked outright by disable_external_dependency_loading
  // below. tests/unit/posthog-options.test.ts pins each key.
  //
  // Heatmaps record click positions; rage clicks and dead clicks record the
  // clicked element's text.
  enable_heatmaps: false,
  capture_heatmaps: false,
  rageclick: false,
  capture_dead_clicks: false,
  // Web vitals and network timing; the remote `capturePerformance` can opt in.
  capture_performance: false,
  // Console lines can embed anything the page printed.
  logs: { captureConsoleLogs: false },
  enable_recording_console_log: false,
  // Support-chat widget, product tours, web experiments and site apps all
  // run remotely configured code in the page.
  disable_conversations: true,
  disable_product_tours: true,
  disable_web_experiments: true,
  opt_in_site_apps: false,
  // Blocks the lazy bundles (replay recorder, surveys, logs, dead clicks, web
  // vitals, exceptions, tours, conversations) from loading at all, so no
  // remote setting can start them. Velai needs none of them: it only calls
  // capture() and the pageview/pageleave hooks, which live in the main bundle.
  disable_external_dependency_loading: true,

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

  // Stop posthog-js remembering the referrer and the campaign tags / ad click
  // ids of the first address (`posthog-core.js` capture(): update_referrer_info
  // and update_campaign_params run only when these are true, so no $referrer,
  // $referring_domain, utm_* or click id is registered onto events, and
  // set_initial_person_info runs only if one of them is true, so no $initial_*).
  // The session-entry and search-keyword copies have no switch; before_send
  // below removes them.
  save_referrer: false,
  save_campaign_params: false,

  // The last stop before an event leaves the browser: no query string or hash
  // in any address, and no referrer, campaign tag or click id (stripUrlQueries).
  before_send: stripUrlQueries,

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
