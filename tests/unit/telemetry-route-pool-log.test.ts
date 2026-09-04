import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { shouldLogMissingPool, resetMissingPoolLogForTests } from "../../src/app/api/telemetry/route";

/**
 * Before this fix, `POST` in route.ts dropped admitted events with ZERO
 * logging whenever `getTelemetryPg()` returned null (e.g. `TELEMETRY_PG_URL`
 * unset) — only the insert-throw path logged. That left a totally silent
 * data-loss branch: the endpoint still returns 204, so nothing short of
 * noticing an empty table would ever surface it.
 *
 * `shouldLogMissingPool` is the pure decision behind the fix: log once per
 * process when there is no pool AND something was actually dropped, never
 * per-request (a sustained misconfiguration must not become its own log-spam
 * outage) and never when a pool exists or nothing was dropped.
 */

beforeEach(() => {
  resetMissingPoolLogForTests();
});

test("shouldLogMissingPool: logs exactly once when the pool is missing and events are being dropped", () => {
  assert.equal(shouldLogMissingPool(false, 3), true, "first drop with no pool must log");
  assert.equal(shouldLogMissingPool(false, 5), false, "a second drop in the same process must not log again");
  assert.equal(shouldLogMissingPool(false, 1), false, "a third drop must still not log again");
});

test("shouldLogMissingPool: never logs when a pool is present, regardless of admitted count", () => {
  assert.equal(shouldLogMissingPool(true, 10), false);
  assert.equal(shouldLogMissingPool(true, 0), false);
});

test("shouldLogMissingPool: never logs when nothing was actually dropped (admitted.length === 0)", () => {
  assert.equal(shouldLogMissingPool(false, 0), false, "no admitted events means nothing was dropped");
});

test("shouldLogMissingPool: the once-per-process gate is independent per test (reset helper works)", () => {
  assert.equal(shouldLogMissingPool(false, 1), true, "gate must start false again after reset");
});
