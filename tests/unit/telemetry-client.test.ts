import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLedgerColumns, randomUuidFallback } from "../../src/lib/telemetry/client";
import { UUID_PATTERN } from "../../src/lib/telemetry/ingest";

/**
 * Defect 1 (ledger columns sent nested in `props`) and Defect 3 (the
 * non-UUID fallback silently dropping every event from browsers without
 * `crypto.randomUUID`) — see the telemetry integration brief. Both bugs
 * were invisible from the wire shape alone: the server rejects malformed
 * events silently (`invalid_shape`), so a wrong client-side decision here
 * never surfaces anywhere except a permanently-null column or a vanished
 * event stream.
 */

test("extractLedgerColumns promotes a string field and the numeric field without mutating the input", () => {
  const original = { job_id: "job-123", position: 4, other: "kept" };
  const input = { ...original };

  const { columns, props } = extractLedgerColumns(input);

  assert.deepEqual(columns, { job_id: "job-123", position: 4 });
  assert.equal("job_id" in props, false);
  assert.equal("position" in props, false);
  assert.deepEqual(props, { other: "kept" });

  // The ORIGINAL object passed in must be untouched — `captureEvent` hands
  // this same reference to `posthog.capture(...)` right before calling
  // `trackToLedger`, so PostHog still needs to see every key it was given.
  assert.deepEqual(input, original);
  assert.equal(Object.prototype.hasOwnProperty.call(input, "job_id"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(input, "position"), true);
});

test("a wrong-typed value is dropped from both columns and props, not forwarded either way", () => {
  const { columns, props } = extractLedgerColumns({
    position: "3", // should be a number per the DDL
    job_id: 42, // should be a string per the DDL
    query_id: "q-1", // correctly typed, promoted normally
  });

  assert.deepEqual(columns, { query_id: "q-1" });
  assert.equal("position" in columns, false);
  assert.equal("job_id" in columns, false);
  assert.equal("position" in props, false, "a malformed value must not silently reach props either");
  assert.equal("job_id" in props, false);
});

test("randomUuidFallback produces a valid, non-constant v4 UUID", () => {
  const first = randomUuidFallback();
  const second = randomUuidFallback();

  assert.match(first, UUID_PATTERN);
  assert.match(second, UUID_PATTERN);
  assert.notEqual(first, second, "two calls must not return the same hardcoded value");
});
