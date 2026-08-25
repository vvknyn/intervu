import type { PostHogConfig } from "posthog-js";

/**
 * What intervu tells PostHog at init.
 *
 * Split out from PostHogProvider so the *decision* (what we collect, and what
 * we deliberately don't) is reviewable and testable without booting React or
 * the posthog-js runtime. tests/unit/posthog-options.test.ts pins the values
 * that have silently broken analytics before — see the notes on each.
 *
 * `api_host` stays at the callsite: it comes from env, not from this decision.
 */

/**
 * Stamped on every event via posthog.register() right after init — this, plus
 * the automatic $host, is how intervu's events are told apart from subspace's
 * inside the one shared PostHog project.
 */
export const POSTHOG_PRODUCT = "intervu";

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
