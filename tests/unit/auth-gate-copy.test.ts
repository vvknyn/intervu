import { test } from "node:test";
import assert from "node:assert/strict";
import {
    formatAuthGateValueLine,
    guestKeepLine,
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
    assert.match(formatAuthGateValueLine("read", 0), /full posting/);
    assert.match(formatAuthGateValueLine("generic", 0), /sync/);
});

test("formatAuthGateValueLine prepends keep-line only when count is real", () => {
    assert.doesNotMatch(formatAuthGateValueLine("read", 0), /keep/i);
    assert.match(formatAuthGateValueLine("read", 2), /keep the 2 roles/);
});
