import test from "node:test";
import assert from "node:assert/strict";
import { agentPreferencesRead, scoringPreferences, type HeldPreferences } from "../../src/lib/agent-preferences-read";
import type { AgentPreferences } from "../../src/actions/agent-preferences";

const german: AgentPreferences = { configured: true, search: { languages: ["german"] }, answers: { custom: {} } };

test("a read that has not answered carries no preferences and no value to render or save", () => {
    for (const held of [null, { uid: "someone-else", prefs: german } satisfies HeldPreferences]) {
        const read = agentPreferencesRead(held, "u1");
        assert.deepEqual(read, { status: "pending" });
        assert.equal("prefs" in read, false);
        assert.equal(scoringPreferences(read), null);
    }
});

test("a read that never answered is failed, not 'none saved'", () => {
    const read = agentPreferencesRead({ uid: "u1", prefs: null, failed: true }, "u1");
    assert.deepEqual(read, { status: "failed" });
    assert.equal(scoringPreferences(read), null);
});

test("a settled read carries the stored preferences, for any account that read them", () => {
    for (const uid of ["u1", "u2"]) {
        const read = agentPreferencesRead({ uid, prefs: german }, uid);
        assert.equal(read.status, "ready");
        assert.equal(scoringPreferences(read), german);
    }
});

test("a signed-out visitor is ready with nothing saved", () => {
    assert.deepEqual(agentPreferencesRead(null, null), { status: "ready", prefs: null });
});
