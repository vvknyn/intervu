import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  maskReplayAttribute,
  maskReplayRequest,
  stripUrlQueries,
  withoutQueryAndHash,
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

test("analytics are anonymous: no person profile is ever created", () => {
  assert.equal(POSTHOG_OPTIONS.person_profiles, "never");
});

test("no autocapture, no heatmaps; pageleave stays on", () => {
  assert.equal(POSTHOG_OPTIONS.capture_pageleave, true);
  assert.equal(POSTHOG_OPTIONS.autocapture, false);
  assert.equal(POSTHOG_OPTIONS.enable_heatmaps, false);
});

// Session replay is on (posthog-js also needs the PostHog project's "Record user
// sessions" switch) but BLIND. Client masking options win over the project's, so
// these values are what /privacy promises; tests/unit/posthog-replay-masking.test.ts
// proves them on the real recorder.
test("session replay is on but hides every word and field, and keeps no console lines or request contents", () => {
  assert.equal(POSTHOG_OPTIONS.disable_session_recording, false);
  assert.equal(POSTHOG_OPTIONS.session_recording?.maskTextSelector, "*", "every text node starred out");
  assert.equal(POSTHOG_OPTIONS.session_recording?.maskAllInputs, true);
  assert.equal(POSTHOG_OPTIONS.session_recording?.maskAllElementAttributes, undefined, "would hide class and style too and leave nothing to watch; maskReplayAttribute does the text ones");
  assert.equal(POSTHOG_OPTIONS.session_recording?.maskAttributeFn, maskReplayAttribute);
  assert.equal(POSTHOG_OPTIONS.session_recording?.maskCapturedNetworkRequestFn, maskReplayRequest);
  assert.equal(POSTHOG_OPTIONS.session_recording?.recordHeaders, false);
  assert.equal(POSTHOG_OPTIONS.session_recording?.recordBody, false);
  assert.equal(POSTHOG_OPTIONS.enable_recording_console_log, false);
  // The recorder is bundled by PostHogProvider; this flag keeps every OTHER lazy bundle out.
  assert.equal(POSTHOG_OPTIONS.disable_external_dependency_loading, true);
});

test("the recorder is bundled with the app, so replay does not depend on the lazy loader being open", () => {
  const provider = readFileSync("src/components/providers/PostHogProvider.tsx", "utf8");
  const recorder = provider.indexOf('import("posthog-js/dist/posthog-recorder")');
  const init = provider.indexOf("posthog.init(");
  assert.ok(recorder > 0, "PostHogProvider imports the recorder");
  assert.ok(recorder < init, "the recorder is on the page before init asks for the project's replay setting");
});

test("a recording keeps no words in attributes and no query string or hash in any address", () => {
  for (const name of ["alt", "title", "placeholder", "aria-label", "value", "label"]) {
    assert.equal(maskReplayAttribute(name, "Jane Doe"), "********", name);
  }
  assert.equal(maskReplayAttribute("href", "/jobs?q=nurse&token=abc#top"), "/jobs");
  assert.equal(maskReplayAttribute("href", "https://velai.app/co/acme?utm_source=x"), "https://velai.app/co/acme");
  // What makes the page look like itself stays.
  for (const name of ["class", "style", "id", "src", "width", "role", "data-state"]) {
    assert.equal(maskReplayAttribute(name, "box"), "box", name);
  }
  const masked = maskReplayRequest({
    name: "https://velai.app/jobs?q=nurse#x", entryType: "navigation", startTime: 1, duration: 2,
    requestHeaders: { authorization: "Bearer x" }, requestBody: "q=nurse", responseHeaders: { a: "b" }, responseBody: "{}",
  } as never);
  assert.equal(masked.name, "https://velai.app/jobs");
  assert.equal(masked.requestHeaders, undefined);
  assert.equal(masked.requestBody, undefined);
  assert.equal(masked.responseHeaders, undefined);
  assert.equal(masked.responseBody, undefined);
  assert.equal(masked.duration, 2, "timing fields survive");
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

test("surveys and exception capture are off: both can carry free text or emails", () => {
  assert.equal(POSTHOG_OPTIONS.disable_surveys, true);
  assert.equal(POSTHOG_OPTIONS.capture_exceptions, false);
});

test("/privacy says recordings hide every word and field, and that there is no autocapture", () => {
  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(privacy, /We record visits for session replay, with every word and field hidden/);
  assert.match(privacy, /never your résumé, a search, your name or your email address/);
  assert.match(privacy, /There is no automatic click capture/);
  assert.match(privacy, /Session recordings are not linked to your account/);
  assert.doesNotMatch(privacy, /There is no session replay/i, "the page must not deny the recordings it now makes");
});

test("every capture lane posthog-js can start from remote config is pinned off", () => {
  // The project is shared with Subspace: a lane left unset follows ITS settings.
  const pinned: Record<string, unknown> = {
    autocapture: false,
    capture_dead_clicks: false,
    rageclick: false,
    enable_heatmaps: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    enable_recording_console_log: false,
    opt_in_site_apps: false,
    // The lazy bundles (logs, recorder, surveys, dead clicks, vitals) never load.
    disable_external_dependency_loading: true,
  };
  for (const [key, expected] of Object.entries(pinned)) {
    assert.deepEqual((POSTHOG_OPTIONS as Record<string, unknown>)[key], expected, key);
  }
  assert.deepEqual(POSTHOG_OPTIONS.logs, { captureConsoleLogs: false });
});

// No address an event carries keeps its query string or hash: the words
// searched, résumé role titles under Rank by fit, a nested copy of either in
// `next=`, or a bearer token.
test("addresses lose query string and hash, whatever the key, and keep path and non-address text", () => {
  assert.equal(withoutQueryAndHash("https://velai.app/jobs?q=%22Registered+Nurse%22&sort=fit&job=abc#top"), "https://velai.app/jobs");
  assert.equal(withoutQueryAndHash("/jobs?country=Canada"), "/jobs");
  assert.equal(withoutQueryAndHash("/reset-password?token=abc123"), "/reset-password");
  assert.equal(withoutQueryAndHash("/co/acme#openings"), "/co/acme");
  assert.equal(withoutQueryAndHash("https://velai.app/jobs"), "https://velai.app/jobs");
  assert.equal(withoutQueryAndHash("https://velai.app?q=x"), "https://velai.app/");
  assert.equal(withoutQueryAndHash("https://example.com/a b?q=x#h"), "https://example.com/a%20b");
  assert.equal(withoutQueryAndHash("/jobs/?q=x"), "/jobs/");
  assert.equal(withoutQueryAndHash("/jobs#a?b"), "/jobs");
  assert.equal(withoutQueryAndHash("//evil.example/x?q=1"), "//evil.example/x?q=1");
  assert.equal(withoutQueryAndHash("what is this? #1 job"), "what is this? #1 job");
  assert.equal(withoutQueryAndHash("q=nurse is not an address"), "q=nurse is not an address");

  const event = {
    uuid: "1",
    event: "$pageview",
    properties: {
      $current_url: "https://velai.app/login?next=%2Fjobs%3Fq%3Dstaff%2Baccountant%26sort%3Dfit",
      $referrer: "https://velai.app/jobs?q=staff+accountant",
      $pathname: "/login",
      $session_entry_url: "https://velai.app/unsubscribe?token=SECRETTOKEN#x",
      $title: "Sign in? Yes",
      count: 3,
      $elements_chain: 'a.recent:attr__href="/jobs?q=staff%20accountant&view=search"href="/jobs?q=staff%20accountant&view=search"nth-child="1"',
      $elements: [{ tag_name: "a", attr__href: "/jobs?q=staff+accountant&view=search", href: "/jobs?q=staff+accountant&view=search" }],
      nested: { return_to: "/jobs?q=nurse" },
    },
    $set_once: { $initial_current_url: "https://velai.app/jobs?q=nurse&sort=fit", $initial_referrer: "https://velai.app/reset-password?token=abc" },
  };
  const sent = stripUrlQueries(event);
  assert.equal(sent?.properties.$current_url, "https://velai.app/login");
  assert.equal("$referrer" in (sent?.properties ?? {}), false);
  assert.equal("$session_entry_url" in (sent?.properties ?? {}), false);
  assert.deepEqual(sent?.$set_once, {});
  assert.equal(sent?.properties.$title, "Sign in? Yes");
  assert.equal(sent?.properties.count, 3);
  assert.deepEqual(sent?.properties.nested, { return_to: "/jobs" });
  const wire = JSON.stringify(sent);
  for (const leak of ["accountant", "SECRETTOKEN", "nurse", "abc"]) assert.equal(wire.includes(leak), false, `${leak} survived`);
  assert.match(sent?.properties.$elements_chain as string, /href="\/jobs"/);
  assert.equal(POSTHOG_OPTIONS.before_send, stripUrlQueries);
});

// Where a visitor came from and which campaign link they followed is not kept
// (/privacy says so). The shape below is what posthog-js 1.414 really attaches
// to a $pageview of a visitor who arrived from betalist.com on a tagged link.
test("before_send drops referrer, campaign tags and ad click ids, by key class", () => {
  const event = {
    uuid: "2",
    event: "$pageview",
    properties: {
      $current_url: "https://velai.app/?utm_source=x&gclid=y",
      $pathname: "/",
      $referrer: "https://betalist.com/startups/velai",
      $referring_domain: "betalist.com",
      $search_engine: "google",
      ph_keyword: "nurse jobs",
      utm_source: "betalist",
      $session_entry_referring_domain: "betalist.com",
      $session_entry_utm_campaign: "launch",
      $session_entry_gclid: "abc",
      $session_entry_fbclid: "def",
      $session_entry_pathname: "/",
      $browser: "Chrome",
    },
    $set_once: { $initial_referring_domain: "betalist.com", $initial_gclid: "abc" },
  };
  const sent = stripUrlQueries(event);
  assert.deepEqual(sent?.properties, {
    $current_url: "https://velai.app/",
    $pathname: "/",
    $browser: "Chrome",
  });
  assert.deepEqual(sent?.$set_once, {});
  assert.equal(POSTHOG_OPTIONS.save_referrer, false);
  assert.equal(POSTHOG_OPTIONS.save_campaign_params, false);
});
