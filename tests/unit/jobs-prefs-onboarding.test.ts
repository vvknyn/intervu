import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeAgentPreferences, type AgentPreferences } from "@/lib/agent/preferences";
import {
    PREFS_ONBOARDING_COMPLETED_KEY,
    canSavePrefsOnboarding,
    shouldShowPrefsOnboarding,
    shouldShowResumeNudge,
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

    it("shows for guests with local AI when not yet completed, even without a résumé", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: false,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: true,
                hasUsableResume: false,
            }),
            true,
        );
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

    it("hides for guests without local AI", () => {
        assert.equal(
            shouldShowPrefsOnboarding({
                localCompleted: false,
                signedIn: false,
                agentPrefsReady: true,
                configured: false,
                localAiEnabled: false,
                hasUsableResume: true,
            }),
            false,
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

describe("canSavePrefsOnboarding", () => {
    it("requires a usable résumé before Save & rank", () => {
        assert.equal(canSavePrefsOnboarding({ hasUsableResume: false }), false);
        assert.equal(canSavePrefsOnboarding({ hasUsableResume: true }), true);
    });
});

describe("shouldShowResumeNudge", () => {
    it("shows when local AI is on and no usable résumé", () => {
        assert.equal(shouldShowResumeNudge({ localAiEnabled: true, hasUsableResume: false }), true);
    });

    it("hides when a usable résumé exists or local AI is off", () => {
        assert.equal(shouldShowResumeNudge({ localAiEnabled: true, hasUsableResume: true }), false);
        assert.equal(shouldShowResumeNudge({ localAiEnabled: false, hasUsableResume: false }), false);
    });
});

describe("prefs onboarding completion storage", () => {
    it("uses a stable localStorage key", () => {
        assert.equal(PREFS_ONBOARDING_COMPLETED_KEY, "intervu.jobs.prefs-onboarding.completed");
    });
});

const PREFS_DIALOG = join(
    __dirname,
    "..",
    "..",
    "src",
    "components",
    "jobs",
    "PrefsOnboardingDialog.tsx",
);

describe("PrefsOnboardingDialog mobile sheet", () => {
    it("pins full-width bottom sheet on small screens with scroll body and sticky footer", () => {
        const src = readFileSync(PREFS_DIALOG, "utf8");
        assert.match(src, /data-testid="prefs-onboarding-dialog"/);
        assert.match(src, /bottom-0 left-0 max-h-\[95dvh\]/);
        assert.match(src, /max-w-none/);
        assert.match(src, /translate-x-0 translate-y-0/);
        assert.match(src, /sm:top-\[50%\]/);
        assert.match(src, /sm:max-h-\[85dvh\]/);
        assert.match(src, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
        assert.match(src, /shrink-0 flex-col/);
        assert.match(src, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
    });

    it("uses full-width inputs on small screens", () => {
        const src = readFileSync(PREFS_DIALOG, "utf8");
        assert.match(src, /className="h-9 w-full rounded-none text-xs sm:max-w-\[180px\]"/);
        assert.match(src, /className="h-9 w-full rounded-none text-xs sm:max-w-\[120px\]"/);
        assert.match(src, /h-9 w-full rounded-none text-xs sm:w-auto/);
    });

    it("includes in-sheet résumé upload before prefs rails", () => {
        const src = readFileSync(PREFS_DIALOG, "utf8");
        assert.match(src, /data-testid="prefs-onboarding-resume"/);
        assert.match(src, /data-testid="prefs-onboarding-resume-file"/);
        assert.match(src, /data-testid="prefs-onboarding-resume-paste"/);
        assert.match(src, /extractResumeFileText/);
        assert.match(src, /canSavePrefsOnboarding/);
        assert.match(src, /data-testid="prefs-onboarding-save"/);
    });
});

const JOBS_PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");

describe("jobs page résumé nudge", () => {
    it("renders toolbar nudge wired to upload when local AI has no résumé", () => {
        const src = readFileSync(JOBS_PAGE, "utf8");
        assert.match(src, /shouldShowResumeNudge/);
        assert.match(src, /data-testid="jobs-resume-nudge"/);
        assert.match(src, /Add résumé to unlock ranked jobs/);
        assert.match(src, /handleUploadClick/);
    });
});

describe("mergeAgentPreferences empty patch (Skip on /jobs)", () => {
    // Skip closes immediately via localStorage; server write runs after dismiss.
    it("sets configured:true so signed-in Skip can dismiss onboarding permanently", () => {
        const out = mergeAgentPreferences(unconfiguredExisting, {});
        assert.equal(out.configured, true);
        assert.deepEqual(out.search, {});
    });
});
