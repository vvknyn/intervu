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
// tuning knob, it is a claim we publish. These two artefacts must not drift.
test("persistence stays cookieless, and /privacy still says so", () => {
  assert.equal(
    POSTHOG_OPTIONS.persistence,
    "memory",
    "Any storage-backed persistence would make /privacy false — update " +
      "that page (and consider a consent banner) before changing this.",
  );

  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  assert.match(
    privacy,
    /cookieless/i,
    "/privacy no longer promises cookieless analytics; the config and the " +
      "published policy have drifted apart.",
  );
  assert.match(
    privacy,
    /memory only/i,
    "/privacy no longer states session state is kept in memory only.",
  );
});

test("no storage-backed persistence can slip in unnoticed", () => {
  // Guards the whole class, not just today's value: every posthog-js
  // persistence mode other than 'memory' writes to the device.
  const WRITES_TO_DEVICE = [
    "cookie",
    "localStorage",
    "localStorage+cookie",
    "sessionStorage",
  ];
  assert.ok(
    !WRITES_TO_DEVICE.includes(String(POSTHOG_OPTIONS.persistence)),
    `persistence '${POSTHOG_OPTIONS.persistence}' stores data on the user's device.`,
  );
});
