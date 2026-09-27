import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    notifySettingsLoadErrorToast,
    resetSettingsLoadErrorDedup,
    shouldEmitSettingsLoadError,
} from "../../src/lib/settings/settings-load-error";

describe("settings load error dedup", () => {
    beforeEach(() => {
        resetSettingsLoadErrorDedup();
    });

    it("allows the first notice per scope", () => {
        assert.equal(shouldEmitSettingsLoadError("agent-access"), true);
    });

    it("suppresses duplicate notices for the same scope within the dedup window", () => {
        assert.equal(shouldEmitSettingsLoadError("agent-access"), true);
        assert.equal(shouldEmitSettingsLoadError("agent-access"), false);
    });

    it("allows a different scope after one scope has claimed the window", () => {
        assert.equal(shouldEmitSettingsLoadError("agent-access"), true);
        assert.equal(shouldEmitSettingsLoadError("agent-preferences"), true);
    });

    it("reset clears suppression so the same scope can notify again", () => {
        assert.equal(shouldEmitSettingsLoadError("agent-access"), true);
        assert.equal(shouldEmitSettingsLoadError("agent-access"), false);
        resetSettingsLoadErrorDedup();
        assert.equal(shouldEmitSettingsLoadError("agent-access"), true);
    });

    it("notifySettingsLoadErrorToast fires the callback at most once per scope burst", () => {
        const seen: string[] = [];
        notifySettingsLoadErrorToast("agent-access", "first", (m) => seen.push(m));
        notifySettingsLoadErrorToast("agent-access", "second", (m) => seen.push(m));
        assert.deepEqual(seen, ["first"]);
    });
});
