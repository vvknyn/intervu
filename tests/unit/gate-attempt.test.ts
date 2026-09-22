import { test } from "node:test";
import assert from "node:assert/strict";
import {
    beginGateAttempt,
    clearGateAttempt,
    generatePendingActionId,
    readGateAttempt,
    gateAttemptEventFields,
    GATE_ATTEMPT_STORAGE_KEY,
    type GateAttemptStorage,
} from "../../src/lib/auth/gate-attempt";
import {
    persistPendingAction,
    takePersistedPendingAction,
    PENDING_ACTION_STORAGE_KEY,
} from "../../src/lib/jobs/pending-actions";

function fakeStorage(): GateAttemptStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem(key) {
            return data.get(key) ?? null;
        },
        setItem(key, value) {
            data.set(key, value);
        },
        removeItem(key) {
            data.delete(key);
        },
    };
}

test("beginGateAttempt: first reason sticks, last reason updates, pending_action_id stable", () => {
    const storage = fakeStorage();
    const id = generatePendingActionId(1000);
    beginGateAttempt(storage, { reason: "fit", originSurface: "jobs_banner", pendingActionId: id, now: 1000 });
    beginGateAttempt(storage, { reason: "resume", originSurface: "jobs_banner", now: 2000 });
    const attempt = readGateAttempt(storage);
    assert.equal(attempt?.firstGateReason, "fit");
    assert.equal(attempt?.lastGateReason, "resume");
    assert.equal(attempt?.pendingActionId, id);
});

test("clearGateAttempt removes stored attempt", () => {
    const storage = fakeStorage();
    beginGateAttempt(storage, { reason: "save", originSurface: "job_detail" });
    clearGateAttempt(storage);
    assert.equal(readGateAttempt(storage), null);
});

test("gateAttemptEventFields maps signup continuity payload", () => {
    const storage = fakeStorage();
    beginGateAttempt(storage, { reason: "fit", originSurface: "for_you", pendingActionId: "gate_1" });
    const fields = gateAttemptEventFields(readGateAttempt(storage));
    assert.equal(fields.first_gate_reason, "fit");
    assert.equal(fields.last_gate_reason, "fit");
    assert.equal(fields.pending_action_id, "gate_1");
    assert.equal(fields.origin_surface, "for_you");
});

test("generatePendingActionId is non-empty", () => {
    assert.match(generatePendingActionId(), /^gate_/);
});

test("readGateAttempt ignores malformed storage", () => {
    const storage = fakeStorage();
    storage.setItem(GATE_ATTEMPT_STORAGE_KEY, "{not-json");
    assert.equal(readGateAttempt(storage), null);
});

test("takePersistedPendingAction does not clear gate attempt", () => {
    const storage = fakeStorage();
    beginGateAttempt(storage, { reason: "fit", originSurface: "for_you", pendingActionId: "gate_1" });
    persistPendingAction(storage, {
        action: { kind: "upload", payload: true },
        returnTo: "/jobs",
        scrollY: 0,
        createdAt: 1000,
    });
    takePersistedPendingAction(storage, { currentPath: "/jobs", now: 1000 });
    assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null);
    const attempt = readGateAttempt(storage);
    assert.equal(attempt?.firstGateReason, "fit");
    assert.equal(attempt?.lastGateReason, "fit");
});

