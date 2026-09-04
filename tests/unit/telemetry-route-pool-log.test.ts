import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordDroppedIngest,
  resetDroppedIngestLogForTests,
  getTelemetryIngestDropStats,
} from "../../src/app/api/telemetry/route";

/**
 * Before this fix, `POST` in route.ts dropped admitted events with ZERO
 * logging whenever `getTelemetryPg()` returned null (e.g. `TELEMETRY_PG_URL`
 * unset) — only the insert-throw path logged. That left a totally silent
 * data-loss branch: the endpoint still returns 204, so nothing short of
 * noticing an empty table would ever surface it.
 *
 * `recordDroppedIngest` is the pure decision behind the fix: it always
 * advances the countable stats (`getTelemetryIngestDropStats`), and it
 * throttles the stdout line itself to once per process — never per-request
 * (a sustained misconfiguration must not become its own log-spam outage)
 * and never when nothing was dropped. See
 * `tests/unit/telemetry-route-ingest-drop-marker.test.ts` for the marker
 * string this gate is paired with and for proof the stats keep moving after
 * the log line has already fired once.
 */

beforeEach(() => {
  resetDroppedIngestLogForTests();
});

test("recordDroppedIngest: reports 'should log' exactly once when events are being dropped", () => {
  assert.equal(recordDroppedIngest(3), true, "first drop must log");
  assert.equal(recordDroppedIngest(5), false, "a second drop in the same process must not log again");
  assert.equal(recordDroppedIngest(1), false, "a third drop must still not log again");
});

test("recordDroppedIngest: never logs when nothing was actually dropped (admitted.length === 0)", () => {
  assert.equal(recordDroppedIngest(0), false, "no admitted events means nothing was dropped");
});

test("recordDroppedIngest: the once-per-process log gate is independent per test (reset helper works)", () => {
  assert.equal(recordDroppedIngest(1), true, "gate must start false again after reset");
});

test("recordDroppedIngest: a count of 0 never moves the stats, even after prior drops", () => {
  recordDroppedIngest(4);
  const before = getTelemetryIngestDropStats();
  recordDroppedIngest(0);
  assert.deepEqual(getTelemetryIngestDropStats(), before, "a no-op call must not touch droppedCount or lastDroppedAt");
});
