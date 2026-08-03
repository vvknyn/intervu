import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWaitlistOutcome } from "../../src/components/marketing/waitlist-outcome";

test("resolveWaitlistOutcome maps a success response to the success outcome", () => {
    assert.deepEqual(resolveWaitlistOutcome({ success: true }), { kind: "success" });
});

test("resolveWaitlistOutcome maps an error response to the error outcome, carrying the real message", () => {
    assert.deepEqual(
        resolveWaitlistOutcome({ error: "Too many attempts — try again in a few minutes." }),
        { kind: "error", message: "Too many attempts — try again in a few minutes." },
    );
});

test("resolveWaitlistOutcome treats a resubmission response (no error, no success flag) as success — idempotent upsert has no separate 'duplicate' outcome", () => {
    assert.deepEqual(resolveWaitlistOutcome({}), { kind: "success" });
});
