import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSlowAuthStep, SLOW_AUTH_STEP_MS } from "../../src/lib/auth/auth-timing";

/**
 * What this protects: sign-in and sign-out steps log only when slow enough to
 * feel, so the logs budget isn't spent on every sign-in while a slow one
 * (the founder's "takes forever", 2026-10-05) still says which step it was.
 */
describe("isSlowAuthStep", () => {
    it("flags a step at or past the threshold", () => {
        assert.equal(SLOW_AUTH_STEP_MS, 1_500);
        assert.equal(isSlowAuthStep(1_500), true);
        assert.equal(isSlowAuthStep(5_100), true);
    });

    it("stays quiet for a normal step and for nonsense", () => {
        assert.equal(isSlowAuthStep(0), false);
        assert.equal(isSlowAuthStep(1_499), false);
        assert.equal(isSlowAuthStep(Number.NaN), false);
        assert.equal(isSlowAuthStep(Number.POSITIVE_INFINITY), false);
    });
});
