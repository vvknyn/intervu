import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import posthog from "posthog-js";
import {
  FUNNEL_EVENTS,
  shouldCaptureFunnelEvent,
  captureFunnelEvent,
} from "../../src/lib/analytics/funnel";

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

// Event-name stability: this map is the naming contract wave-3 wiring
// commits to. Renaming any value here breaks every dashboard funnel built on
// the old string, so a fixed-object assertion is the guard.
test("FUNNEL_EVENTS pins the exact wire names wave-3 will wire up", () => {
  assert.deepEqual(FUNNEL_EVENTS, {
    search_submitted: "search_submitted",
    result_clicked: "result_clicked",
    apply_clicked: "apply_clicked",
    job_saved: "job_saved",
    company_followed: "company_followed",
    signup_completed: "signup_completed",
  });
});

test("shouldCaptureFunnelEvent requires both a window and a loaded posthog", () => {
  assert.equal(shouldCaptureFunnelEvent(true, true), true);
  assert.equal(shouldCaptureFunnelEvent(false, true), false, "SSR: no window");
  assert.equal(
    shouldCaptureFunnelEvent(true, false),
    false,
    "no NEXT_PUBLIC_POSTHOG_KEY: posthog.init() never ran",
  );
  assert.equal(shouldCaptureFunnelEvent(false, false), false);
});

test("captureFunnelEvent is a safe no-op when PostHog was never initialized", (t) => {
  const capture = t.mock.method(posthog, "capture", () => {});
  // posthog.__loaded is already false here — nothing was initialized.
  assert.doesNotThrow(() => {
    captureFunnelEvent("search_submitted", {
      query_length: 5,
      has_location: false,
      filter_count: 0,
    });
  });
  assert.equal(capture.mock.calls.length, 0);
});

test("captureFunnelEvent is a safe no-op under SSR even when posthog is loaded", (t) => {
  const capture = t.mock.method(posthog, "capture", () => {});
  const originalLoaded = posthog.__loaded;
  posthog.__loaded = true;
  try {
    assert.equal("window" in globalThis, false, "this test needs the Node env's real absence of window");
    captureFunnelEvent("job_saved", { job_id: "job-1" });
    assert.equal(capture.mock.calls.length, 0);
  } finally {
    posthog.__loaded = originalLoaded;
  }
});

test("captureFunnelEvent sends search_submitted with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureFunnelEvent("search_submitted", {
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

test("captureFunnelEvent sends company_followed with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureFunnelEvent("company_followed", { company_domain: "acme.com" });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "company_followed",
      { company_domain: "acme.com" },
    ]);
  });
});

test("captureFunnelEvent sends result_clicked with the exact name and payload shape", (t) => {
  withReadyPostHog(t, (capture) => {
    captureFunnelEvent("result_clicked", { position: 3, job_id: "job-9", source: "serp" });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(capture.mock.calls[0].arguments, [
      "result_clicked",
      { position: 3, job_id: "job-9", source: "serp" },
    ]);
  });
});
