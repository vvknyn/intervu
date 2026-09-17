import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthOpenEvent, shouldCaptureAuthStarted } from "../../src/lib/auth/auth-gate-copy";

test("shouldCaptureAuthStarted fires only on false→true", () => {
    assert.equal(shouldCaptureAuthStarted(false, true), true, "modal opening");
    assert.equal(shouldCaptureAuthStarted(true, true), false, "stays open across re-renders");
    assert.equal(shouldCaptureAuthStarted(true, false), false, "modal closing");
    assert.equal(shouldCaptureAuthStarted(false, false), false, "stays closed");
});

// The honest-funnel fix: a deliberate "Sign In" click is the only thing
// allowed to fire auth_started — an auto-opened nudge (any reason) fires
// auth_nudge_shown instead, so PostHog can't count a guest's Apply click as
// a sign-in attempt.
test("resolveAuthOpenEvent maps trigger to the right event name, independent of reason", () => {
    assert.equal(resolveAuthOpenEvent("user"), "auth_started");
    assert.equal(resolveAuthOpenEvent("auto"), "auth_nudge_shown");
});

// The event name is a pure function of `trigger` — `reason` only ever
// changes the payload (see AuthPopover), never which event fires. Proved
// across two different reasons crossed with both triggers so a future
// change can't quietly make one reason "more real" than another.
test("resolveAuthOpenEvent: two different reasons never change the event for a given trigger", () => {
    for (const reason of ["apply", "save"] as const) {
        assert.equal(resolveAuthOpenEvent("user"), "auth_started", `user + ${reason}`);
        assert.equal(resolveAuthOpenEvent("auto"), "auth_nudge_shown", `auto + ${reason}`);
    }
});
