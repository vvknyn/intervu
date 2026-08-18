import { test } from "node:test";
import assert from "node:assert/strict";
import {
    resolveAllowance,
    resolveSpend,
    resolveGrant,
    getCreditState,
    FALLBACK_CREDIT_STATE,
    WELCOME_CREDITS,
} from "../../src/lib/llm/credit-gate";

/* --------------------------------- resolveAllowance --------------------------------- */
// Month rollover: the allowance resets when the stored period no longer
// matches; a separately-tracked earned balance (resolveGrant/resolveSpend
// below) is never part of this function's input, proving the rollover rule
// has no path to touching it.

test("resolveAllowance refills on a new period", () => {
    assert.equal(resolveAllowance({ credits: 0, credits_period: "2026-07" }, "2026-08"), 10);
});

test("resolveAllowance keeps the stored value within the same period", () => {
    assert.equal(resolveAllowance({ credits: 7, credits_period: "2026-08" }, "2026-08"), 7);
});

test("resolveAllowance refills when never set", () => {
    assert.equal(resolveAllowance({}, "2026-08"), 10);
});

/* --------------------------------- resolveSpend --------------------------------- */
// Spend order + the block condition.

test("spend drains the allowance first when both pools have room", () => {
    const spend = resolveSpend(5, 20);
    assert.deepEqual(spend, { blocked: false, allowance: 4, earned: 20 });
});

test("spend falls through to earned once the allowance is exhausted", () => {
    const spend = resolveSpend(0, 20);
    assert.deepEqual(spend, { blocked: false, allowance: 0, earned: 19 });
});

test("blocked only when both pools are zero", () => {
    assert.deepEqual(resolveSpend(0, 0), { blocked: true });
    assert.deepEqual(resolveSpend(0, 1), { blocked: false, allowance: 0, earned: 0 });
    assert.deepEqual(resolveSpend(1, 0), { blocked: false, allowance: 0, earned: 0 });
});

test("month rollover preserves earned while resetting the allowance (composed scenario)", () => {
    // Last period: allowance exhausted, 15 earned banked from grants.
    const stored = { credits: 0, credits_period: "2026-07", credits_earned: 15 };
    const period = "2026-08"; // new month

    const allowanceBeforeReset = resolveAllowance(stored, "2026-07");
    assert.equal(allowanceBeforeReset, 0);

    const allowanceAfterReset = resolveAllowance(stored, period);
    assert.equal(allowanceAfterReset, 10, "allowance refills on rollover");

    // resolveSpend never receives credits_earned through the allowance path —
    // the earned figure below comes straight off the stored record,
    // unmodified by the period change.
    assert.equal(stored.credits_earned, 15, "earned is untouched by rollover");

    const spend = resolveSpend(allowanceAfterReset, stored.credits_earned);
    assert.deepEqual(spend, { blocked: false, allowance: 9, earned: 15 }, "post-rollover spend drains the fresh allowance, not earned");
});

/* --------------------------------- resolveGrant --------------------------------- */
// Idempotency under the same key; additive under a different key.

test("a grant under a fresh key is additive to the current earned balance", () => {
    assert.deepEqual(resolveGrant(false, 0, WELCOME_CREDITS), { write: true, earned: WELCOME_CREDITS });
    assert.deepEqual(resolveGrant(false, 5, 20), { write: true, earned: 25 });
});

test("a grant under an already-recorded key is a no-op (idempotent, no double-credit)", () => {
    assert.deepEqual(resolveGrant(true, 20, WELCOME_CREDITS), { write: false });
});

test("two different keys stack additively rather than overwriting", () => {
    const afterFirst = resolveGrant(false, 0, WELCOME_CREDITS); // key A: welcome
    assert.equal(afterFirst.write, true);
    const earnedAfterFirst = afterFirst.write ? afterFirst.earned : 0;
    const afterSecond = resolveGrant(false, earnedAfterFirst, 5); // key B: referral
    assert.deepEqual(afterSecond, { write: true, earned: WELCOME_CREDITS + 5 });
});

/* --------------------------------- FALLBACK_CREDIT_STATE / getCreditState --------------------------------- */
// The display fallback must not invent an earned balance.

test("the fallback credit state reports zero earned, never a fabricated balance", () => {
    assert.equal(FALLBACK_CREDIT_STATE.earned, 0);
    assert.equal(FALLBACK_CREDIT_STATE.isAdmin, false);
    assert.equal(FALLBACK_CREDIT_STATE.total, FALLBACK_CREDIT_STATE.allowance);
});

test("getCreditState falls back (no earned balance invented) when there is no server session", async () => {
    // No Firebase session exists in the unit-test process, so getServerUser()
    // resolves to null (or the surrounding try/catch fails closed) — either
    // way this must land on FALLBACK_CREDIT_STATE, not a guessed earned figure.
    const state = await getCreditState();
    assert.equal(state.earned, 0);
    assert.deepEqual(state, FALLBACK_CREDIT_STATE);
});
