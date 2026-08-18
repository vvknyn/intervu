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
