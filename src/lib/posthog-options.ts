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
  // route change (/jobs -> /co/[slug] -> /trends) was invisible.
  //
  // The monitor dedupes on pathname, so this neither double-counts the initial
  // pageview nor fires on query-only changes (/jobs?q=... filter edits).
  capture_pageview: "history_change",

  capture_pageleave: true,
  autocapture: true,

  // Uncaught errors and unhandled rejections in the browser -> `$exception`
  // events (PostHog Error Tracking). The project had none, so client crashes
  // such as React #418/#419 on /jobs were invisible. `true` captures
  // unhandled errors and unhandled rejections; console.error capture stays off
  // (noisy, and console text is where PII leaks). Set locally, so it does not
  // depend on the project-level Error Tracking toggle (currently unset).
  capture_exceptions: true,

  // Needed *because* api_host is now our own origin.
  //
  // posthog-js derives the UI host by string-replacing the ingestion subdomain
  // out of api_host (`request-router.ts`, the `uiHost` getter). That rewrite
  // assumes a posthog.com address; against "https://velai.app/ph" it
  // matches nothing and hands the toolbar and every "view in PostHog" link a
  // URL pointing back at us. Naming the real UI host keeps those working.
  ui_host: "https://us.posthog.com",

  // Session replay is enabled at the PostHog project level, so it is already
  // recording — which means /privacy has to disclose it. The masking that
  // disclosure promises must be OURS, not posthog-js's default:
  // @posthog/types documents no `@default` for maskAllInputs (compare
  // maskAttributeFn right below it, which does), so leaving it unset would
  // rest a published privacy claim on a third-party value we neither control
  // nor can test. Setting it here makes "what you type isn't captured" a
  // decision in this repo.
  session_recording: {
    maskAllInputs: true,
  },

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

/**
 * Below this width, PostHog surveys are turned off entirely (`disable_surveys`
 * — "disable all surveys functionality", @posthog/types posthog-config.d.ts —
 * not `disable_surveys_automatic_display`, which only skips the automatic
 * popover and still lets the extension load). The mobile layout audit found
 * the survey tab's shadow-DOM host overlapping row content at 390/360 and
 * not at 768; hiding it with CSS was rejected because the shadow host still
 * mounts underneath — this stops it mounting at all.
 */
export const PHONE_SURVEY_BREAKPOINT = "(max-width: 767px)";

/**
 * Pure decision: the init options for a given phone/non-phone viewport.
 * Takes the already-resolved boolean rather than reading `matchMedia`
 * itself, so it needs no DOM to test.
 */
export function postHogOptionsForViewport(
  isPhoneViewport: boolean,
): Partial<PostHogConfig> {
  return { ...POSTHOG_OPTIONS, disable_surveys: isPhoneViewport };
}

/**
 * Thin I/O: resolves whether the current viewport is at/under the phone
 * survey breakpoint. SSR-safe — `window`/`matchMedia` don't exist on the
 * server, and the correct default there is "surveys on" (unchanged
 * behaviour) since a server render can't know the eventual viewport.
 */
export function isPhoneSurveyViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(PHONE_SURVEY_BREAKPOINT).matches;
}
