import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowSearchRequest,
  checkRateLimitWindow,
  clearRateLimitStateForTests,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "../../src/lib/shield/rate-limit";

test("checkRateLimitWindow: admits requests under the cap and records the timestamp", () => {
  const { allowed, retained } = checkRateLimitWindow([], 1_000, 60_000, 3);
  assert.equal(allowed, true);
  assert.deepEqual(retained, [1_000]);
});

test("checkRateLimitWindow: refuses once the window is at the cap, without recording it", () => {
  const timestamps = [1_000, 2_000, 3_000];
  const { allowed, retained } = checkRateLimitWindow(timestamps, 3_500, 60_000, 3);
  assert.equal(allowed, false);
  // Rejected request is never pushed — the window's contents are unchanged.
  assert.deepEqual(retained, timestamps);
});

test("checkRateLimitWindow: sliding, not fixed — entries age out individually as time passes", () => {
  // 3 requests at t=0, cap=3, window=1000ms. At t=1001 the first has aged
  // out, so exactly one more request is admitted.
  const timestamps = [0, 100, 200];
  const first = checkRateLimitWindow(timestamps, 1_001, 1_000, 3);
  assert.equal(first.allowed, true);
  assert.deepEqual(first.retained, [100, 200, 1_001]);

  // Immediately trying a second one at the same instant is refused — still
  // 3 live entries (100, 200, 1001) inside the window.
  const second = checkRateLimitWindow(first.retained, 1_001, 1_000, 3);
  assert.equal(second.allowed, false);
});

test("checkRateLimitWindow: defaults match the exported generous-limit constants", () => {
  const timestamps = Array.from({ length: RATE_LIMIT_MAX_REQUESTS }, (_, i) => i);
  const { allowed } = checkRateLimitWindow(timestamps, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  assert.equal(allowed, false);
});

test("allowSearchRequest: per-IP — one IP's burst never affects another IP", () => {
  clearRateLimitStateForTests();
  const now = 10_000;
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
    assert.equal(allowSearchRequest("1.2.3.4", now + i), true);
  }
  assert.equal(allowSearchRequest("1.2.3.4", now + RATE_LIMIT_MAX_REQUESTS), false);
  // A different IP starts with a fresh window.
  assert.equal(allowSearchRequest("5.6.7.8", now + RATE_LIMIT_MAX_REQUESTS), true);
  clearRateLimitStateForTests();
});

test("allowSearchRequest: the window recovers once old requests age out", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
    assert.equal(allowSearchRequest("9.9.9.9", now), true);
  }
  assert.equal(allowSearchRequest("9.9.9.9", now), false);
  assert.equal(allowSearchRequest("9.9.9.9", now + RATE_LIMIT_WINDOW_MS + 1), true);
  clearRateLimitStateForTests();
});
