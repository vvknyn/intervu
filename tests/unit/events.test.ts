import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import posthog from "posthog-js";
import {
  ANALYTICS_EVENTS,
  shouldCaptureEvent,
  captureEvent,
} from "../../src/lib/analytics/events";

/**
 * The Node test env has no `window` and posthog.__loaded starts false (no
 * init() ever ran), which is exactly the "PostHog absent" state — so the
 * no-op tests below need no setup at all. The positive-capture tests are the
 * ones that must stand up a fixture; this fixture is that "PostHog is up and
 * ready" state, mocking posthog.capture and restoring everything after.
 */
function withReadyPostHog(t: TestContext, fn: (capture: ReturnType<TestContext["mock"]["method"]>) => void) {
  const capture = t.mock.method(posthog, "capture", () => {});
  const originalLoaded = posthog.__loaded;
  posthog.__loaded = true;
  const hadWindow = "window" in globalThis;
  if (!hadWindow) (globalThis as { window?: unknown }).window = {};
  try {
    fn(capture);
  } finally {
    posthog.__loaded = originalLoaded;
    if (!hadWindow) delete (globalThis as { window?: unknown }).window;
  }
}

// Event-name stability: this map is the naming contract every dashboard
// funnel/chart is built on. Renaming any value here breaks whatever's
// already built on the old string, so a fixed-object assertion is the
// guard — deliberately exhaustive (all 19), not a sample, so a new event
// added to ANALYTICS_EVENTS without a matching line here fails loudly
// instead of just widening silently.
test("ANALYTICS_EVENTS pins the exact wire name for every declared event", () => {
  assert.deepEqual(ANALYTICS_EVENTS, {
    // Original wave-3 six — wire names are a dashboard contract, never rename.
    search_submitted: "search_submitted",
    result_clicked: "result_clicked",
    apply_clicked: "apply_clicked",
    job_saved: "job_saved",
    company_followed: "company_followed",
    signup_completed: "signup_completed",

    job_viewed: "job_viewed",
    job_unsaved: "job_unsaved",
    job_marked_applied: "job_marked_applied",
    // Wire name kept as the pre-existing "share_initiated" — see events.ts.
    job_shared: "share_initiated",
    job_match_expanded: "job_match_expanded",

    company_viewed: "company_viewed",
    company_unfollowed: "company_unfollowed",

    search_zero_results: "search_zero_results",
    search_filter_applied: "search_filter_applied",
    search_results_paged: "search_results_paged",
    results_impressed: "results_impressed",

    search_alert_impressed: "search_alert_impressed",
    search_alert_submitted: "search_alert_submitted",
    search_alert_verified: "search_alert_verified",
    search_alert_dismissed: "search_alert_dismissed",

    application_stage_changed: "application_stage_changed",
    resume_uploaded: "resume_uploaded",
  });
});

test("shouldCaptureEvent requires both a window and a loaded posthog", () => {
  assert.equal(shouldCaptureEvent(true, true), true);
  assert.equal(shouldCaptureEvent(false, true), false, "SSR: no window");
  assert.equal(
    shouldCaptureEvent(true, false),
    false,
    "no NEXT_PUBLIC_POSTHOG_KEY: posthog.init() never ran",
  );
  assert.equal(shouldCaptureEvent(false, false), false);
});

test("captureEvent is a safe no-op when PostHog was never initialized", (t) => {
  const capture = t.mock.method(posthog, "capture", () => {});
  // posthog.__loaded is already false here — nothing was initialized.
  assert.doesNotThrow(() => {
    captureEvent("search_submitted", {
      query_length: 5,
      has_location: false,
      filter_count: 0,
    });
  });
  assert.equal(capture.mock.calls.length, 0);
});

test("captureEvent is a safe no-op under SSR even when posthog is loaded", (t) => {
  const capture = t.mock.method(posthog, "capture", () => {});
  const originalLoaded = posthog.__loaded;
  posthog.__loaded = true;
  try {
    assert.equal("window" in globalThis, false, "this test needs the Node env's real absence of window");
    captureEvent("job_saved", { job_id: "job-1" });
    assert.equal(capture.mock.calls.length, 0);
  } finally {
    posthog.__loaded = originalLoaded;
  }
});

test("captureEvent sends search_submitted with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("search_submitted", {
      query_length: 12,
      has_location: true,
      filter_count: 2,
    });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "search_submitted",
      { query_length: 12, has_location: true, filter_count: 2 },
    ]);
  });
});

test("captureEvent sends company_followed with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("company_followed", { company_domain: "acme.com" });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "company_followed",
      { company_domain: "acme.com" },
    ]);
  });
});

test("captureEvent sends result_clicked with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("result_clicked", { position: 3, job_id: "job-9", source: "serp" });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "result_clicked",
      { position: 3, job_id: "job-9", source: "serp" },
    ]);
  });
});

// Below: entity-catalog coverage (design item 2). Each exercises a payload
// shape that's distinct enough to be worth its own compile-time+behavioral
// proof — a nullable field, an array field, a wire-name divergence from its
// key, and an empty payload — rather than one test per all 13 new events,
// which would just re-prove the same pass-through six more times.

test("captureEvent sends job_viewed with a nullable company_domain", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("job_viewed", { job_id: "job-1", company_domain: null, source: "direct" });
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "job_viewed",
      { job_id: "job-1", company_domain: null, source: "direct" },
    ]);
  });
});

// job_shared is the one event whose ANALYTICS_EVENTS wire name diverges
// from its own key ("share_initiated", not "job_shared") — see events.ts's
// doc comment. This proves captureEvent sends the WIRE name, not the key,
// so an existing "share_initiated" dashboard metric keeps working.
test("captureEvent sends job_shared under its pre-existing wire name", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("job_shared", { job_id: "job-1", method: "native" });
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "share_initiated",
      { job_id: "job-1", method: "native" },
    ]);
  });
});

test("captureEvent sends results_impressed with the full job_ids batch", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("results_impressed", {
      job_ids: ["job-1", "job-2"],
      positions: [1, 2],
      count: 2,
      source: "serp",
    });
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "results_impressed",
      { job_ids: ["job-1", "job-2"], positions: [1, 2], count: 2, source: "serp" },
    ]);
  });
});

test("captureEvent sends resume_uploaded with an empty payload", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent("resume_uploaded", {});
    assert.deepEqual(capture.mock.calls[0].arguments, ["resume_uploaded", {}]);
  });
});
