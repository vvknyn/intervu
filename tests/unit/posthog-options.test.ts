import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isPhoneSurveyViewport,
  maskReplayNetworkRequest,
  stripSearchTerms,
  withoutSearchTerms,
  PHONE_SURVEY_BREAKPOINT,
  POSTHOG_OPTIONS,
  POSTHOG_PRODUCT,
  postHogOptionsForViewport,
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

test("pageleave and autocapture stay on, and autocapture records no words", () => {
  assert.equal(POSTHOG_OPTIONS.capture_pageleave, true);
  assert.ok(POSTHOG_OPTIONS.autocapture, "autocapture must stay on");
  assert.equal(POSTHOG_OPTIONS.mask_all_text, true, "a click must not send the text it landed on ($el_text)");
  const ignored = typeof POSTHOG_OPTIONS.autocapture === "object" ? POSTHOG_OPTIONS.autocapture.element_attribute_ignorelist : [];
  for (const name of ["title", "aria-label", "value", "placeholder", "alt"]) {
    assert.ok(ignored?.includes(name), `autocapture must drop the ${name} attribute`);
  }
});

test("exception autocapture stays on so client crashes reach Error Tracking", () => {
  assert.equal(POSTHOG_OPTIONS.capture_exceptions, true);
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

// Phone survey gate (mobile layout audit, 2026-09-18): the survey widget's
// shadow-DOM host overlapped row content at 390/360, not at 768 — so surveys
// must turn off strictly below 768px, matching `disable_surveys`, the
// posthog-js option that stops the extension mounting at all (verified
// against the installed package's own types, not assumed from the name).

type StubbableGlobal = { window?: { matchMedia: (query: string) => { matches: boolean } } };

function withStubbedMatchMedia<T>(matches: boolean, fn: () => T): T {
  const g = globalThis as unknown as StubbableGlobal;
  const original = g.window;
  g.window = {
    matchMedia: (query: string) => {
      assert.equal(
        query,
        PHONE_SURVEY_BREAKPOINT,
        "must query the documented phone breakpoint, not a different one",
      );
      return { matches };
    },
  };
  try {
    return fn();
  } finally {
    g.window = original;
  }
}

test("isPhoneSurveyViewport: matches at 767px, not at 768px or 1440px", () => {
  // matchMedia itself decides whether the query matches at a given width;
  // these three stub the answer a real 767/768/1440px viewport would give.
  assert.equal(withStubbedMatchMedia(true, () => isPhoneSurveyViewport()), true, "767px");
  assert.equal(withStubbedMatchMedia(false, () => isPhoneSurveyViewport()), false, "768px");
  assert.equal(withStubbedMatchMedia(false, () => isPhoneSurveyViewport()), false, "1440px");
});

test("isPhoneSurveyViewport is SSR-safe: no window means surveys stay on", () => {
  const g = globalThis as unknown as StubbableGlobal;
  const original = g.window;
  delete g.window;
  try {
    assert.equal(isPhoneSurveyViewport(), false);
  } finally {
    g.window = original;
  }
});

test("postHogOptionsForViewport disables surveys only on the phone viewport, and changes nothing else", () => {
  const phone = postHogOptionsForViewport(true);
  const desktop = postHogOptionsForViewport(false);
  assert.equal(phone.disable_surveys, true);
  assert.equal(desktop.disable_surveys, false);

  // Same base config either way — this builder adds exactly one field, it
  // does not fork the options object.
  for (const key of Object.keys(POSTHOG_OPTIONS) as (keyof typeof POSTHOG_OPTIONS)[]) {
    assert.deepEqual(phone[key], POSTHOG_OPTIONS[key]);
    assert.deepEqual(desktop[key], POSTHOG_OPTIONS[key]);
  }
});

// Replay records real screens. The masking /privacy promises therefore has to
// be a value in this repo, not a posthog-js default that can move under us.
test("session replay masks typed input and every word on the page, and /privacy says so", () => {
  assert.equal(
    POSTHOG_OPTIONS.session_recording?.maskAllInputs,
    true,
    "Replay is on at the project level; without explicit masking, /privacy's " +
      "promise that typed input is never captured rests on a library default.",
  );
  assert.equal(
    POSTHOG_OPTIONS.session_recording?.maskTextSelector,
    "*",
    "Replays used to show the résumé page and the Customize dialog as written; every text node must be masked.",
  );
  const maskAttribute = POSTHOG_OPTIONS.session_recording?.maskAttributeFn;
  assert.equal(typeof maskAttribute, "function");
  assert.equal(maskAttribute!("title", "Senior nurse, ICU"), "****** ****** ***");
  assert.equal(maskAttribute!("class", "row muted"), "row muted");

  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  assert.match(
    privacy,
    /session replay is enabled/i,
    "Replay is on but /privacy no longer discloses it.",
  );
  assert.match(
    privacy,
    /masked/i,
    "/privacy no longer states that typed input is masked.",
  );
});

// Analytics are tied to a signed-in account, so no address they carry keeps
// the words searched: typed text, or the résumé's role titles under Rank by
// fit (`?q=...&sort=fit`). The anonymous search log is the only copy.
test("analytics addresses drop the words searched, typed or built from a résumé, and keep everything else", () => {
  const fit = 'https://velai.app/jobs?q=%22Registered+Nurse%22+OR+%22Charge+Nurse%22&sort=fit&job=abc';
  assert.equal(withoutSearchTerms(fit), "https://velai.app/jobs?sort=fit&job=abc");
  assert.equal(withoutSearchTerms("https://velai.app/jobs?q=nurse&sort=newest"), "https://velai.app/jobs?sort=newest");
  assert.equal(withoutSearchTerms("/jobs?q=nurse&country=Canada"), "/jobs?country=Canada");
  assert.equal(withoutSearchTerms("https://velai.app/jobs?country=Canada"), "https://velai.app/jobs?country=Canada");
  assert.equal(withoutSearchTerms("q=nurse is not an address"), "q=nurse is not an address");

  const event = {
    uuid: "1",
    event: "$autocapture",
    properties: {
      $current_url: fit,
      $referrer: "https://velai.app/jobs?q=staff+accountant",
      $pathname: "/jobs",
      count: 3,
      $elements_chain: 'a.recent:attr__href="/jobs?q=staff%20accountant&view=search"href="/jobs?q=staff%20accountant&view=search"nth-child="1"',
      $elements: [{ tag_name: "a", attr__href: "/jobs?q=staff+accountant&view=search", href: "/jobs?q=staff+accountant&view=search" }],
    },
    $set_once: { $initial_current_url: fit },
  };
  const sent = stripSearchTerms(event);
  assert.equal(sent?.properties.$current_url, "https://velai.app/jobs?sort=fit&job=abc");
  assert.equal(sent?.properties.$referrer, "https://velai.app/jobs");
  assert.equal(sent?.$set_once?.$initial_current_url, "https://velai.app/jobs?sort=fit&job=abc");
  assert.equal(sent?.properties.count, 3);
  assert.equal(JSON.stringify(sent).includes("accountant"), false, "a clicked search link keeps no search words");
  assert.match(sent?.properties.$elements_chain as string, /href="\/jobs\?view=search"/);
  assert.equal(POSTHOG_OPTIONS.before_send, stripSearchTerms);

  const request = maskReplayNetworkRequest({ name: fit, requestBody: '{"q":"Nurse"}', responseBody: "{}" } as never);
  assert.equal(request.name, "https://velai.app/jobs?sort=fit&job=abc");
  assert.equal(request.requestBody, null);
  assert.equal(request.responseBody, null);
});
