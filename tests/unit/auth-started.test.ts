import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAuthOpenEvent } from "../../src/lib/auth/auth-gate-copy";
import { authStartedPayloadFromAttempt } from "../../src/lib/analytics/auth-event-payload";
import type { GateAttempt } from "../../src/lib/auth/gate-attempt";

const ROOT = join(__dirname, "../..");

function readSrc(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

// Opening the modal or /login is curiosity, not a funnel start. Auto prompts
// still record auth_nudge_shown. auth_started waits for a real method.
test("resolveAuthOpenEvent: user open emits nothing, auto emits auth_nudge_shown", () => {
    assert.equal(resolveAuthOpenEvent("user"), null);
    assert.equal(resolveAuthOpenEvent("auto"), "auth_nudge_shown");
});

test("resolveAuthOpenEvent does not change with reason: no user open is auth_started", () => {
    for (const reason of ["apply", "save", "tracker", "alert", "topbar"] as const) {
        assert.equal(resolveAuthOpenEvent("user"), null, `user + ${reason}`);
        assert.equal(resolveAuthOpenEvent("auto"), "auth_nudge_shown", `auto + ${reason}`);
    }
});

test("method engagement payload uses the gate attempt and trigger_type user", () => {
    const attempt: GateAttempt = {
        pendingActionId: "gate_1",
        firstGateReason: "save",
        lastGateReason: "tracker",
        originSurface: "job_detail",
        returnTo: "/jobs/role",
        jobId: "job-1",
        createdAt: 1,
    };
    const payload = authStartedPayloadFromAttempt(attempt);
    assert.equal(payload.reason, "tracker");
    assert.equal(payload.gate_reason, "tracker");
    assert.equal(payload.trigger_type, "user");
    assert.equal(payload.first_gate_reason, "save");
    assert.equal(payload.last_gate_reason, "tracker");
    assert.equal(payload.pending_action_id, "gate_1");
    assert.equal(payload.origin_surface, "job_detail");
    assert.equal(payload.job_id, "job-1");
    assert.equal(payload.return_to, "/jobs/role");
});

test("method engagement with no gate attempt defaults reason to generic", () => {
    const payload = authStartedPayloadFromAttempt(null);
    assert.equal(payload.reason, "generic");
    assert.equal(payload.gate_reason, "generic");
    assert.equal(payload.trigger_type, "user");
    assert.equal(payload.first_gate_reason, undefined);
    assert.equal(payload.origin_surface, undefined);
    assert.equal(payload.job_id, undefined);
    assert.equal(payload.return_to, undefined);
});

test("modal and /login open do not fire auth_started; login-form does, on method seams", () => {
    const popover = readSrc("src/components/auth/auth-popover.tsx");
    const loginClient = readSrc("src/app/login/login-client.tsx");
    const form = readSrc("src/components/auth/login-form.tsx");

    assert.doesNotMatch(popover, /captureEvent\(\s*["']auth_started["']/);
    assert.match(popover, /resolveAuthOpenEvent\(trigger\)/);
    assert.match(popover, /ensureGateAttemptRecorded\(/);
    assert.match(popover, /captureEvent\(\s*["']auth_nudge_shown["']/);
    assert.doesNotMatch(loginClient, /captureEvent\(\s*["']auth_started["']/);
    assert.match(loginClient, /beginGateAttempt\(/);

    assert.match(form, /function captureAuthStartedFromGate\(/);
    assert.match(form, /captureEvent\('auth_started'/);

    const startAuthKit = form.slice(form.indexOf("const startAuthKit"), form.indexOf("const handleSignUp"));
    const startedAt = startAuthKit.indexOf("captureAuthStartedFromGate()");
    const methodAt = startAuthKit.indexOf("captureEvent('auth_method_selected'");
    const navAt = startAuthKit.indexOf("window.location.href");
    assert.ok(startedAt !== -1, "startAuthKit fires auth_started");
    assert.ok(methodAt !== -1 && startedAt < methodAt, "startAuthKit fires auth_started before auth_method_selected");
    assert.ok(navAt !== -1 && startedAt < navAt, "startAuthKit fires auth_started before navigation");

    const submit = form.slice(form.indexOf("onSubmit={(e) =>"), form.indexOf("void (activeTab"));
    const submitStarted = submit.indexOf("captureAuthStartedFromGate()");
    const submitMethod = submit.indexOf("captureEvent('auth_method_selected'");
    assert.match(submit, /method: 'username'/);
    assert.ok(submitStarted !== -1 && submitMethod !== -1 && submitStarted < submitMethod, "username submit fires auth_started before auth_method_selected");
});
