import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    HISTORY_EMPTY_DESCRIPTION,
    HISTORY_EMPTY_TITLE,
    TRACKER_EMPTY_TITLE,
} from "../../src/lib/pursuits/tracker-voice-copy";

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

describe("Phase 2 — voice onboarding batch", () => {
    it("P2-3 history empty uses tracker voice module and matches tracker CTA hierarchy", () => {
        const history = read("src/app/yours/history/page.tsx");
        assert.match(history, /HISTORY_EMPTY_TITLE/);
        assert.match(history, /HISTORY_EMPTY_DESCRIPTION/);
        assert.match(history, /variant="outline"[\s\S]*size="sm"/);
        assert.equal(HISTORY_EMPTY_TITLE, "Your history is empty.");
        assert.notEqual(HISTORY_EMPTY_TITLE, TRACKER_EMPTY_TITLE);
        assert.match(HISTORY_EMPTY_DESCRIPTION, /Search or For you/i);

        const mock = read("src/components/mock/EmptyStatesMock.tsx");
        assert.match(mock, /HISTORY_EMPTY_TITLE/);
        assert.match(mock, /HISTORY_EMPTY_DESCRIPTION/);
    });

    it("P2-10 onboarding step numbering uses Concept A plain index label", () => {
        const label = read("src/components/onboarding/onboarding-step-label.tsx");
        assert.match(label, /font-semibold tabular-nums/);
        assert.match(label, /\{step\}\./);
        assert.doesNotMatch(label, /Step \{step\}/);

        const landing = read("src/components/onboarding/LandingOnboardingView.tsx");
        assert.match(landing, /OnboardingStepLabel step=\{step\}/);
        assert.doesNotMatch(landing, /Step \{step\} of 3/);

        const modal = read("src/components/onboarding/FirstTimeOnboardingModal.tsx");
        assert.match(modal, /OnboardingStepLabel step=\{step\}/);
        assert.doesNotMatch(modal, /Step \{step\} of 3/);

        const conceptA = read("src/components/onboarding/ConceptALanding.tsx");
        assert.doesNotMatch(conceptA, /OnboardingStepLabel/);
    });

    it("P2-11 stacked auth dialog returns focus to opener on close", () => {
        const auth = read("src/components/auth/auth-popover.tsx");
        assert.match(auth, /returnFocusRef/);
        assert.match(auth, /onCloseAutoFocus=\{handleDialogCloseAutoFocus\}/);
        assert.match(auth, /event\.preventDefault\(\)/);
        assert.match(auth, /target\.focus\(\{ preventScroll: true \}\)/);
        const dialogBranch = auth.slice(auth.indexOf("if (!showTrigger)"), auth.indexOf("return (", auth.indexOf("<Popover")));
        assert.match(dialogBranch, /onCloseAutoFocus/);
    });

    it("P1-13 email nudge uses visible Field labels and 16px inputs", () => {
        const prompt = read("src/components/account/AccountEmailPrompt.tsx");
        assert.match(prompt, /Field label=\{EMAIL_FIELD_LABEL\}/);
        assert.match(prompt, /EMAIL_FIELD_LABEL = "Email for job alerts"/);
        assert.match(prompt, /placeholder="you@example.com"/);
        assert.notEqual("Email for job alerts", "you@example.com");
        assert.match(prompt, /text-base/);
        assert.match(prompt, /htmlFor="account-email-input-needs"/);
        assert.match(prompt, /htmlFor="account-email-input-pending"/);
    });
});
