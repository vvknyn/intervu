import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldCaptureAuthStarted } from "../../src/lib/auth/auth-gate-copy";

test("shouldCaptureAuthStarted fires only on false→true", () => {
    assert.equal(shouldCaptureAuthStarted(false, true), true, "modal opening");
    assert.equal(shouldCaptureAuthStarted(true, true), false, "stays open across re-renders");
    assert.equal(shouldCaptureAuthStarted(true, false), false, "modal closing");
    assert.equal(shouldCaptureAuthStarted(false, false), false, "stays closed");
});
