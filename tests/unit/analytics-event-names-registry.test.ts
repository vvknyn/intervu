import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_EVENTS as LEAF_EVENTS } from "../../src/lib/analytics/event-names";
import { ANALYTICS_EVENTS as REEXPORTED_EVENTS } from "../../src/lib/analytics/events";
import { RESULTS_IMPRESSED, RESULT_CLICKED, APPLY_CLICKED, JOB_SAVED } from "../../src/lib/telemetry/outcome-events";

/**
 * Conformance test for the wire-name registry split (src/lib/analytics/
 * event-names.ts is now the single declaration; events.ts re-exports it,
 * outcome-events.ts derives from it). Before this split, the same four
 * strings were typed out independently in both events.ts and
 * outcome-events.ts with zero import between them — a rename on one side
 * would silently stop matching rows on the other (rollup-fetch.ts's
 * `where e.event_name = $2`). This test asserts the values are the SAME
 * BINDING (traced through imports), not just two literals that happen to
 * match today.
 */

test("outcome-events.ts's four exported constants are identical to their ANALYTICS_EVENTS counterparts", () => {
  assert.equal(RESULTS_IMPRESSED, LEAF_EVENTS.results_impressed);
  assert.equal(RESULT_CLICKED, LEAF_EVENTS.result_clicked);
  assert.equal(APPLY_CLICKED, LEAF_EVENTS.apply_clicked);
  assert.equal(JOB_SAVED, LEAF_EVENTS.job_saved);
});

test("events.ts re-exports the exact same ANALYTICS_EVENTS map as event-names.ts, for every key — not just the four outcome-events.ts uses", () => {
  // Deliberately asserts the WHOLE map, not a hand-picked subset: proves the
  // re-export in events.ts is faithful for keys that motivated nothing here
  // (e.g. `search_zero_results`), which is the only way to know events.ts
  // didn't fork its own copy instead of actually re-exporting.
  assert.deepEqual(REEXPORTED_EVENTS, LEAF_EVENTS);
  assert.equal(REEXPORTED_EVENTS.search_zero_results, LEAF_EVENTS.search_zero_results);
});
