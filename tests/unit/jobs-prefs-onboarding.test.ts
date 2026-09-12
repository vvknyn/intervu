import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeAgentPreferences, type AgentPreferences } from "@/lib/agent/preferences";
import {
    PREFS_ONBOARDING_COMPLETED_KEY,
    shouldShowPrefsOnboarding,
} from "@/lib/jobs/prefs-onboarding";

const unconfiguredExisting: AgentPreferences = {
    configured: false,
    search: {},
    answers: { custom: {} },
};

describe("shouldShowPrefsOnboarding", () => {
    it("returns false when local onboarding is marked complete", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: true,
                signedIn: true,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: true,
                hasUsableResume: true,
            }),
            false,
        );
    });

    it("shows for signed-in users when prefs are loaded and not yet configured", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: true,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: false,
                hasUsableResume: false,
            }),
            true,
        );
    });

    it("hides for signed-in users when already configured, even if local completion is false", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: true,
                agentPrefsReady: true,
                configured: true,
                localAiEnabled: true,
                hasUsableResume: true,
            }),
            false,
        );
    });

    it("hides for signed-in users until agent prefs have loaded", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: true,
                agentPrefsReady: false,
                configured: false,
                localAiEnabled: false,
                hasUsableResume: false,
            }),
            false,
        );
    });

    it("shows for guests with local AI and a usable résumé when not yet completed", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: false,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: true,
                hasUsableResume: true,
            }),
            true,
        );
    });

    it("hides for guests once local onboarding is complete", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: true,
                signedIn: false,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: true,
                hasUsableResume: true,
            }),
            false,
        );
    });

    it("skip marks complete — onboarding stays hidden", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: true,
                signedIn: true,
                agentPrefsReady: true,
                configured: true,
                localAiEnabled: false,
                hasUsableResume: false,
            }),
            false,
        );
    });

    it("save marks complete — onboarding stays hidden", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: true,
                signedIn: false,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: true,
                hasUsableResume: true,
            }),
            false,
        );
    });
});

describe("prefs onboarding completion storage", () => {
    it("uses a stable localStorage key", () => {
        assert.equal(PREFS_ONBOARDING_COMPLETED_KEY, "intervu.jobs.prefs-onboarding.completed");
    });
});

describe("mergeAgentPreferences empty patch (Skip on /jobs)", () => {
    it("sets configured:true so signed-in Skip can dismiss onboarding permanently", () => {
        const out = mergeAgentPreferences(unconfiguredExisting, {});
        assert.equal(out.configured, true);
        assert.deepEqual(out.search, {});
    });
});
