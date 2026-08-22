import { test } from "node:test";
import assert from "node:assert/strict";
import {
    formatAuthGateValueLine,
    guestKeepLine,
    SIGNUP_SUBCOPY,
} from "../../src/lib/auth/auth-gate-copy";

test("guestKeepLine is null for zero count", () => {
    assert.equal(guestKeepLine(0), null);
});

test("guestKeepLine uses singular copy for one pursuit", () => {
    assert.match(guestKeepLine(1)!, /role you've saved/);
});

test("guestKeepLine uses plural copy for multiple pursuits", () => {
    assert.match(guestKeepLine(3)!, /3 roles/);
});

test("formatAuthGateValueLine varies by reason class", () => {
    assert.match(formatAuthGateValueLine("apply", 0), /posting/);
    assert.match(formatAuthGateValueLine("generic", 0), /sync/);
});

test("formatAuthGateValueLine prepends keep-line only when count is real", () => {
    assert.doesNotMatch(formatAuthGateValueLine("generic", 0), /keep/i);
    assert.match(formatAuthGateValueLine("generic", 2), /keep the 2 roles/);
});

// Wave-2 signup-ladder audit (2026-08-20): the header's new "Get job
// alerts" CTA opens straight to the signup tab, whose only value pitch is
// this subcopy — it has to actually name the alerts/tracker promise the
// button just made, not a generic "save roles" line.
test("SIGNUP_SUBCOPY names the alerts/saved-search/tracker value triad", () => {
    assert.match(SIGNUP_SUBCOPY, /alert/i);
    assert.match(SIGNUP_SUBCOPY, /saved search/i);
    assert.match(SIGNUP_SUBCOPY, /tracker/i);
});
