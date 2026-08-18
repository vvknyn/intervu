import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowAuthSessionRequest,
  allowAuthSignupRequest,
  allowConnectWaitlistRequest,
  allowJobsSuggestRequest,
  allowSearchRequest,
  AUTH_SESSION_MAX_REQUESTS,
  AUTH_SESSION_WINDOW_MS,
  AUTH_SIGNUP_MAX_REQUESTS,
  checkRateLimitWindow,
  clearRateLimitStateForTests,
  CONNECT_WAITLIST_MAX_REQUESTS,
  JOBS_SUGGEST_MAX_REQUESTS,
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

test("allowConnectWaitlistRequest: keeps its own per-IP window, separate from search's", () => {
  clearRateLimitStateForTests();
  const now = 0;
  // Exhaust the waitlist window for one IP...
  for (let i = 0; i < CONNECT_WAITLIST_MAX_REQUESTS; i++) {
    assert.equal(allowConnectWaitlistRequest("1.2.3.4", now), true);
  }
  assert.equal(allowConnectWaitlistRequest("1.2.3.4", now), false);
  // ...without touching that same IP's search allowance (proves the two
  // chokepoints don't share a counter).
  assert.equal(allowSearchRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("allowConnectWaitlistRequest: a different IP starts with a fresh window", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < CONNECT_WAITLIST_MAX_REQUESTS; i++) {
    assert.equal(allowConnectWaitlistRequest("2.2.2.2", now), true);
  }
  assert.equal(allowConnectWaitlistRequest("2.2.2.2", now), false);
  assert.equal(allowConnectWaitlistRequest("3.3.3.3", now), true);
  clearRateLimitStateForTests();
});

test("allowJobsSuggestRequest: keeps its own per-IP window, separate from search's and the waitlist's", () => {
  clearRateLimitStateForTests();
  const now = 0;
  // Exhaust the suggest window for one IP...
  for (let i = 0; i < JOBS_SUGGEST_MAX_REQUESTS; i++) {
    assert.equal(allowJobsSuggestRequest("1.2.3.4", now), true);
  }
  assert.equal(allowJobsSuggestRequest("1.2.3.4", now), false);
  // ...without touching that same IP's search or waitlist allowance (proves
  // the three chokepoints don't share a counter).
  assert.equal(allowSearchRequest("1.2.3.4", now), true);
  assert.equal(allowConnectWaitlistRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("allowJobsSuggestRequest: a different IP starts with a fresh window", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < JOBS_SUGGEST_MAX_REQUESTS; i++) {
    assert.equal(allowJobsSuggestRequest("4.4.4.4", now), true);
  }
  assert.equal(allowJobsSuggestRequest("4.4.4.4", now), false);
  assert.equal(allowJobsSuggestRequest("5.5.5.5", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthSessionRequest: keeps its own per-IP window, separate from the other chokepoints'", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SESSION_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSessionRequest("1.2.3.4", now), true);
  }
  assert.equal(allowAuthSessionRequest("1.2.3.4", now), false);
  // ...without touching that same IP's search, waitlist, or suggest allowance.
  assert.equal(allowSearchRequest("1.2.3.4", now), true);
  assert.equal(allowConnectWaitlistRequest("1.2.3.4", now), true);
  assert.equal(allowJobsSuggestRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthSessionRequest: window boundary — one ms before AUTH_SESSION_WINDOW_MS still exhausted, exactly at it the oldest hits have aged out (strict `t > cutoff`)", () => {
  clearRateLimitStateForTests();
  const start = 1_000;
  for (let i = 0; i < AUTH_SESSION_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSessionRequest("6.6.6.6", start), true);
  }
  // One ms short of the window: cutoff = start - 1, so the original hits
  // (t === start) are still `t > cutoff` and still counted — still exhausted.
  assert.equal(allowAuthSessionRequest("6.6.6.6", start + AUTH_SESSION_WINDOW_MS - 1), false);
  // Exactly at the window: cutoff === start, so `t > cutoff` is now false for
  // those same hits — they've aged out and a slot opens.
  assert.equal(allowAuthSessionRequest("6.6.6.6", start + AUTH_SESSION_WINDOW_MS), true);
  clearRateLimitStateForTests();
});

test("allowAuthSessionRequest: a different IP starts with a fresh window", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SESSION_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSessionRequest("7.7.7.7", now), true);
  }
  assert.equal(allowAuthSessionRequest("7.7.7.7", now), false);
  assert.equal(allowAuthSessionRequest("8.8.8.8", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthSignupRequest: its own store, separate from the session limiter's even for the same IP", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SIGNUP_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSignupRequest("1.2.3.4", now), true);
  }
  assert.equal(allowAuthSignupRequest("1.2.3.4", now), false);
  // Signup is exhausted, but the SAME ip's session budget is untouched.
  assert.equal(allowAuthSessionRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});
