import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POSTHOG_OPTIONS,
  POSTHOG_PRODUCT,
} from "../../src/lib/posthog-options";

// The bug this file exists to prevent: a config value that *looks* enabled but
// silently isn't. `capture_pageview: true` reads as "yes, capture pageviews",
// but posthog-js starts its History-API monitor only on a strict
// `=== "history_change"` check — so `true` pinned the legacy init-only mode and
// every client-side navigation in this App Router SPA went unrecorded.

test('capture_pageview is the "history_change" mode, not a truthy boolean', () => {
  assert.equal(
    POSTHOG_OPTIONS.capture_pageview,
    "history_change",
    "posthog-js only monitors the History API when this is exactly " +
      '"history_change"; `true` silently records one $pageview per hard ' +
      "load and nothing for client-side navigation.",
  );
});

test("guests stay unprofiled until identify() runs", () => {
  assert.equal(POSTHOG_OPTIONS.person_profiles, "identified_only");
});

test("pageleave and autocapture stay on", () => {
  assert.equal(POSTHOG_OPTIONS.capture_pageleave, true);
  assert.equal(POSTHOG_OPTIONS.autocapture, true);
});

test("events carry the product super-property that separates intervu from subspace", () => {
  // One shared PostHog project; without this stamp intervu's events are
  // indistinguishable from subspace's.
  assert.equal(POSTHOG_PRODUCT, "intervu");
});

// A different case than the one that surfaced the bug: persistence is not a
// tuning knob, it is a claim we publish. Keying the required wording BY the
// mode is what keeps this guard honest across a change of mode — pinning one
// literal value would have to be deleted to change the setting, and a guard
// you delete to make your change pass guards nothing.
const PRIVACY_PROMISE_BY_PERSISTENCE: Record<string, RegExp[]> = {
  memory: [/cookieless/i, /memory only/i],
  sessionStorage: [/no analytics cookie is set/i, /close the tab/i],
};

/**
 * Modes that outlive the tab. Each is cross-visit tracking, which needs a
 * consent banner intervu does not have — a hard floor, independent of
 * whatever wording the map above grows to carry.
 */
const SURVIVES_TAB_CLOSE = ["cookie", "localStorage", "localStorage+cookie"];

test("the configured persistence mode is one /privacy actually describes", () => {
  const mode = String(POSTHOG_OPTIONS.persistence);
  const promises = PRIVACY_PROMISE_BY_PERSISTENCE[mode];
  assert.ok(
    promises,
    `persistence '${mode}' has no published wording. Decide what /privacy ` +
      "must say about it, and add it to PRIVACY_PROMISE_BY_PERSISTENCE, " +
      "before shipping the change.",
  );

  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  for (const promise of promises) {
    assert.match(
      privacy,
      promise,
      `/privacy no longer carries ${promise}: the config says '${mode}' and ` +
        "the published policy has drifted away from it.",
    );
  }
});

test("persistence never outlives the tab", () => {
  assert.ok(
    !SURVIVES_TAB_CLOSE.includes(String(POSTHOG_OPTIONS.persistence)),
    `persistence '${POSTHOG_OPTIONS.persistence}' survives closing the tab, ` +
      "which is cross-visit tracking — intervu has no consent banner.",
  );
});

// Replay records real screens. The masking /privacy promises therefore has to
// be a value in this repo, not a posthog-js default that can move under us.
test("session replay masks typed input, and /privacy says so", () => {
  assert.equal(
    POSTHOG_OPTIONS.session_recording?.maskAllInputs,
    true,
    "Replay is on at the project level; without explicit masking, /privacy's " +
      "promise that typed input is never captured rests on a library default.",
  );

  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  assert.match(
    privacy,
    /records a replay/i,
    "Replay is on but /privacy no longer discloses it.",
  );
  assert.match(
    privacy,
    /masked/i,
    "/privacy no longer states that typed input is masked.",
  );
});
