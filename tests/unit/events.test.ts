import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import posthog from "posthog-js";
import {
  ANALYTICS_EVENTS,
  shouldCaptureEvent,
  captureEvent,
  buildLedgerProps,
  LEDGER_ONLY_PROPS_BUDGET,
} from "../../src/lib/analytics/events";
import { extractLedgerColumns } from "../../src/lib/telemetry/client";
import { MAX_PROPS_LENGTH, processBatch } from "../../src/lib/telemetry/ingest";

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
// guard — deliberately exhaustive (all 24), not a sample, so a new event
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
    auth_started: "auth_started",
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

// --- ledger-only props (query text) ---------------------------------------
//
// Requirement: raw search query TEXT must reach the ledger (this repo's own
// Postgres-backed telemetry store), keyed to the account, and must NEVER
// reach PostHog. `captureEvent`'s optional third argument carries props that
// only `buildLedgerProps` ever sees — the two sinks differ by construction
// (separate arguments to captureEvent), not by a "remember to strip it"
// convention. See events.ts's `LedgerOnlyPayloads` and `captureEvent`.

test("buildLedgerProps merges ledgerOnly in when given, and is a no-op passthrough without it", () => {
  const payload = { query_length: 5, has_location: false, filter_count: 0 };

  const merged = buildLedgerProps(payload, { query_text: "senior engineer" });
  assert.deepEqual(merged, { ...payload, query_text: "senior engineer" });
  assert.equal("ledger_truncated" in merged, false, "a payload under the cap carries no truncation flag");

  // No third argument at all — every existing call site's shape. Must be
  // exactly the payload, nothing added or removed.
  assert.deepEqual(buildLedgerProps(payload), payload);
});

// A ledger-only value the caller can't bound (raw user input — a search box
// accepts a full pasted job description) must never be able to take its own
// event down. See LEDGER_ONLY_PROPS_BUDGET's doc comment in events.ts.
//
// The bound is on the WHOLE ledgerOnly object's SERIALIZED size, not a
// per-value raw character count — `JSON.stringify` inflates control
// characters ~6x, and a per-value cap stops protecting anything the moment
// a second ledger-only field is added (two individually-"safe" values can
// still jointly overflow the shared budget). The three tests below prove
// both failure modes the old per-value character-count cap missed.

test("buildLedgerProps: an oversized plain-text ledger-only value is truncated, flagged, and the event survives processBatch instead of being rejected as props_too_large", () => {
  const payload = { query_length: 4100, has_location: false, filter_count: 0 };
  const pastedJobDescription = "x".repeat(4100); // alone, well past MAX_PROPS_LENGTH once stringified

  const merged = buildLedgerProps(payload, { query_text: pastedJobDescription });

  assert.equal(merged.ledger_truncated, true);
  assert.ok(
    JSON.stringify({ query_text: merged.query_text }).length <= LEDGER_ONLY_PROPS_BUDGET,
    "the ledger-only contribution alone must fit its own budget",
  );
  assert.ok(
    JSON.stringify(merged).length <= MAX_PROPS_LENGTH,
    "the bounded props must fit under ingest.ts's own cap",
  );

  const { rows, rejections } = processBatch(
    [
      {
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        session_id: crypto.randomUUID(),
        event_name: "search_submitted",
        props: merged,
      },
    ],
    Date.now(),
  );

  assert.equal(rejections.length, 0, `expected the event to survive, got ${JSON.stringify(rejections)}`);
  assert.equal(rows.length, 1);
});

test("buildLedgerProps: the bound is generic — a ledger-only key other than query_text is bounded the same way", () => {
  const merged = buildLedgerProps({ some_metric: 1 }, { some_future_field: "y".repeat(5000) });

  assert.equal(merged.ledger_truncated, true);
  assert.ok(
    JSON.stringify({ some_future_field: merged.some_future_field }).length <= LEDGER_ONLY_PROPS_BUDGET,
  );
});

// Reviewer's exact repro: a 200-CHARACTER control-character string sits
// right at the boundary of the old per-value cap (`200 > 200` is false, so
// the old code left it completely untouched) while its SERIALIZED form
// (JSON.stringify escapes each control char to a 6-byte \uXXXX sequence)
// blows past 1200 characters — 6x the raw length and far past any
// reasonable per-payload budget. This must fail against the old
// per-value-raw-length cap and pass against the new serialized-size bound.
test("buildLedgerProps: a 200-char control-character string (old cap's exact boundary) is bounded by its SERIALIZED size, not its raw length", () => {
  const controlCharQuery = "\u0001".repeat(200); // raw length 200; serialized length ~1200+

  const merged = buildLedgerProps({}, { query_text: controlCharQuery });
  const serializedContribution = JSON.stringify({ query_text: merged.query_text }).length;

  assert.equal(merged.ledger_truncated, true, "a value whose SERIALIZED form exceeds the budget must be flagged, even at exactly the old cap's raw-length boundary");
  assert.ok(
    serializedContribution <= LEDGER_ONLY_PROPS_BUDGET,
    `serialized ledger-only contribution ${serializedContribution} must fit the budget ${LEDGER_ONLY_PROPS_BUDGET}`,
  );
});

// Class proof, not instance proof: the defect wasn't just "control
// characters serialize larger" — it was "the budget is per-payload, not
// per-value." Six plain-ASCII fields, each individually far under any
// single-value cap the old code ever enforced (200 chars), still jointly
// overflow the real per-payload budget once combined. The old per-value cap
// would have left every one of these six fields completely untouched.
test("buildLedgerProps: several individually-small ledger-only fields are still bounded JOINTLY, not per value", () => {
  const manyFields = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`field_${i}`, "a".repeat(180)]),
  );

  const merged = buildLedgerProps({}, manyFields);
  const contributionKeys = Object.keys(manyFields);
  const serializedContribution = JSON.stringify(
    Object.fromEntries(contributionKeys.map((k) => [k, merged[k]])),
  ).length;

  assert.equal(
    merged.ledger_truncated,
    true,
    "six fields that are each individually under any plausible per-value cap must still trigger truncation once combined",
  );
  assert.ok(
    serializedContribution <= LEDGER_ONLY_PROPS_BUDGET,
    `combined serialized ledger-only contribution ${serializedContribution} must fit the budget ${LEDGER_ONLY_PROPS_BUDGET}`,
  );
});

// Turns the "set well below MAX_PROPS_LENGTH" comment in events.ts into an
// enforced relationship: events.ts is browser code and must never import
// ingest.ts (a server-only module), so this test — which can safely import
// both — is the one place the two constants are checked against each other.
test("LEDGER_ONLY_PROPS_BUDGET stays comfortably below ingest.ts's MAX_PROPS_LENGTH", () => {
  assert.ok(
    LEDGER_ONLY_PROPS_BUDGET < MAX_PROPS_LENGTH,
    `LEDGER_ONLY_PROPS_BUDGET (${LEDGER_ONLY_PROPS_BUDGET}) must stay below MAX_PROPS_LENGTH (${MAX_PROPS_LENGTH})`,
  );
  assert.ok(
    LEDGER_ONLY_PROPS_BUDGET <= MAX_PROPS_LENGTH / 2,
    "the ledger-only budget must leave at least half of MAX_PROPS_LENGTH for the rest of the event's payload",
  );
});

test("composition proof: a ledger-only prop merged via buildLedgerProps lands in extractLedgerColumns' props, not columns", () => {
  const merged = buildLedgerProps(
    { query_length: 5, has_location: false, filter_count: 0 },
    { query_text: "staff engineer remote" },
  );
  const { columns, props } = extractLedgerColumns(merged);

  // query_text is not one of the 5 promoted ledger columns — it must stay
  // in the JSONB `props` blob, never get promoted to a top-level column.
  assert.equal(props.query_text, "staff engineer remote");
  assert.equal("query_text" in columns, false);
});

test("captureEvent never hands ledgerOnly props to posthog.capture — the privacy-load-bearing assertion", (t) => {
  withReadyPostHog(t, (capture) => {
    captureEvent(
      "search_submitted",
      { query_length: 19, has_location: true, filter_count: 1 },
      { query_text: "some raw query text" },
    );

    assert.equal(capture.mock.calls.length, 1);
    const posthogPayload = capture.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal("query_text" in posthogPayload, false, "raw query text must never reach PostHog");
    assert.deepEqual(posthogPayload, { query_length: 19, has_location: true, filter_count: 1 });
  });
});
