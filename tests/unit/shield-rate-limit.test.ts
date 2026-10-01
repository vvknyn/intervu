import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowAuthResetRequest,
  allowAuthSignInRequest,
  allowAuthAccountCreate,
  allowAuthSignupSubmit,
  allowConnectWaitlistRequest,
  allowJobsSuggestRequest,
  allowSearchRequest,
  AUTH_RESET_REQUEST_MAX_REQUESTS,
  AUTH_SIGNIN_MAX_REQUESTS,
  AUTH_SIGNIN_WINDOW_MS,
  AUTH_SIGNUP_CREATE_MAX_REQUESTS,
  AUTH_SIGNUP_CREATE_WINDOW_MS,
  AUTH_SIGNUP_SUBMIT_MAX_REQUESTS,
  checkRateLimitWindow,
  clearRateLimitStateForTests,
  CONNECT_WAITLIST_MAX_REQUESTS,
  JOBS_SUGGEST_MAX_REQUESTS,
  minutesLabel,
  msUntilSlotFrees,
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

test("allowAuthSignInRequest: keeps its own per-IP window, separate from the other chokepoints'", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SIGNIN_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSignInRequest("1.2.3.4", now), true);
  }
  assert.equal(allowAuthSignInRequest("1.2.3.4", now), false);
  // ...without touching that same IP's search, waitlist, or suggest allowance.
  assert.equal(allowSearchRequest("1.2.3.4", now), true);
  assert.equal(allowConnectWaitlistRequest("1.2.3.4", now), true);
  assert.equal(allowJobsSuggestRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthSignInRequest: window boundary — one ms before AUTH_SIGNIN_WINDOW_MS still exhausted, exactly at it the oldest hits have aged out (strict `t > cutoff`)", () => {
  clearRateLimitStateForTests();
  const start = 1_000;
  for (let i = 0; i < AUTH_SIGNIN_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSignInRequest("6.6.6.6", start), true);
  }
  // One ms short of the window: cutoff = start - 1, so the original hits
  // (t === start) are still `t > cutoff` and still counted — still exhausted.
  assert.equal(allowAuthSignInRequest("6.6.6.6", start + AUTH_SIGNIN_WINDOW_MS - 1), false);
  // Exactly at the window: cutoff === start, so `t > cutoff` is now false for
  // those same hits — they've aged out and a slot opens.
  assert.equal(allowAuthSignInRequest("6.6.6.6", start + AUTH_SIGNIN_WINDOW_MS), true);
  clearRateLimitStateForTests();
});

test("allowAuthSignInRequest: a different IP starts with a fresh window", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SIGNIN_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSignInRequest("7.7.7.7", now), true);
  }
  assert.equal(allowAuthSignInRequest("7.7.7.7", now), false);
  assert.equal(allowAuthSignInRequest("8.8.8.8", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthResetRequest: its own store, separate from sign-in's even for the same IP", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_RESET_REQUEST_MAX_REQUESTS; i++) {
    assert.equal(allowAuthResetRequest("1.2.3.4", now), true);
  }
  assert.equal(allowAuthResetRequest("1.2.3.4", now), false);
  // Reset requests are exhausted, but the SAME ip's sign-in budget is untouched.
  assert.equal(allowAuthSignInRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("allowAuthAccountCreate: its own store, separate from sign-in's even for the same IP", () => {
  clearRateLimitStateForTests();
  const now = 0;
  for (let i = 0; i < AUTH_SIGNUP_CREATE_MAX_REQUESTS; i++) {
    assert.equal(allowAuthAccountCreate("1.2.3.4", now), true);
  }
  assert.equal(allowAuthAccountCreate("1.2.3.4", now), false);
  // Account creation is exhausted, but the SAME ip's sign-in budget is untouched.
  assert.equal(allowAuthSignInRequest("1.2.3.4", now), true);
  clearRateLimitStateForTests();
});

test("signup submits and account creations are counted apart: a visitor fixing mistakes never spends the creation budget", () => {
  clearRateLimitStateForTests();
  const now = 0;
  // The 2026-10-01 replay: seven presses inside two minutes. Under the old
  // single 5-per-10-min budget the sixth was refused before anything ran.
  for (let i = 0; i < 7; i++) assert.equal(allowAuthSignupSubmit("49.36.0.1", now + i * 10_000), true);
  // None of those reached createUser, so the first real attempt still gets through.
  assert.equal(allowAuthAccountCreate("49.36.0.1", now + 80_000), true);
  clearRateLimitStateForTests();
});

test("allowAuthSignupSubmit: a flood guard well above anything a person does, still finite", () => {
  clearRateLimitStateForTests();
  assert.ok(AUTH_SIGNUP_SUBMIT_MAX_REQUESTS >= 20, "sized for typo fixes and carrier NAT, not for a person to meet");
  for (let i = 0; i < AUTH_SIGNUP_SUBMIT_MAX_REQUESTS; i++) {
    assert.equal(allowAuthSignupSubmit("9.9.9.9", 0), true);
  }
  assert.equal(allowAuthSignupSubmit("9.9.9.9", 0), false);
  clearRateLimitStateForTests();
});

test("retryAfterMs: 0 while a slot is free, then the time until the oldest counted hit ages out; reading it never counts", () => {
  clearRateLimitStateForTests();
  assert.equal(allowAuthAccountCreate.retryAfterMs("5.5.5.5", 0), 0);
  for (let i = 0; i < AUTH_SIGNUP_CREATE_MAX_REQUESTS; i++) {
    assert.equal(allowAuthAccountCreate("5.5.5.5", i * 60_000), true);
  }
  const now = 5 * 60_000;
  assert.equal(allowAuthAccountCreate.retryAfterMs("5.5.5.5", now), AUTH_SIGNUP_CREATE_WINDOW_MS - now);
  // Reading did not use a slot: exactly at that moment one opens.
  assert.equal(allowAuthAccountCreate("5.5.5.5", AUTH_SIGNUP_CREATE_WINDOW_MS), true);
  clearRateLimitStateForTests();
});

test("msUntilSlotFrees: the hit that has to age out is the oldest one beyond the cap", () => {
  assert.equal(msUntilSlotFrees([], 0, 60_000, 2), 0);
  assert.equal(msUntilSlotFrees([10_000], 20_000, 60_000, 2), 0);
  assert.equal(msUntilSlotFrees([30_000, 10_000], 40_000, 60_000, 2), 30_000);
  // A hit already out of the window does not count.
  assert.equal(msUntilSlotFrees([0, 50_000], 70_000, 60_000, 2), 0);
});

test("minutesLabel: whole minutes, rounded up, never zero", () => {
  assert.equal(minutesLabel(0), "1 minute");
  assert.equal(minutesLabel(59_000), "1 minute");
  assert.equal(minutesLabel(60_001), "2 minutes");
  assert.equal(minutesLabel(600_000), "10 minutes");
});
