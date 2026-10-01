import { test } from "node:test";
import assert from "node:assert/strict";
import { signInRateLimitMessage, signupRateLimitMessage } from "../../src/lib/auth/auth-refusal-copy";
import { MIN_PASSWORD_LENGTH, NEW_PASSWORD_HINT, newPasswordProblem } from "../../src/lib/auth/password-rules";

/**
 * Every refusal on the password forms says what happened, how long to wait,
 * and the ways in it doesn't block (Google and the passkey/email-code button
 * go through WorkOS AuthKit, which no per-IP limit here touches). The old line
 * was "Too many attempts — try again in a few minutes." (2026-10-01 replay).
 */

test("a signup refusal names the wait in minutes and the two ways in above the form", () => {
    const message = signupRateLimitMessage(7 * 60_000 + 1);
    assert.match(message, /^Too many sign-up tries from your network just now\./);
    assert.match(message, /Try again in 8 minutes/);
    assert.match(message, /Continue with Google or the email code above/);
});

test("a sign-in refusal does the same, in its own words", () => {
    const message = signInRateLimitMessage(30_000);
    assert.match(message, /sign-in tries/);
    assert.match(message, /Try again in 1 minute,/);
});

test("the password rule and the hint under the field state the same number", () => {
    assert.ok(NEW_PASSWORD_HINT.startsWith(`${MIN_PASSWORD_LENGTH}+ characters`));
    assert.equal(newPasswordProblem("x".repeat(MIN_PASSWORD_LENGTH - 1)), `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    assert.equal(newPasswordProblem("x".repeat(MIN_PASSWORD_LENGTH)), null);
});

test("the form no longer promises the old Firebase floor of 6", () => {
    assert.ok(MIN_PASSWORD_LENGTH >= 8);
    assert.doesNotMatch(NEW_PASSWORD_HINT, /\b6\+/);
});
