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

const ONBOARDING_PROSE_FILES = [
    "src/components/onboarding/FirstTimeOnboardingModal.tsx",
    "src/components/onboarding/LandingOnboardingView.tsx",
    "src/components/onboarding/onboarding-step-label.tsx",
];

/** Standalone lowercase product name — not velai.app URLs or code identifiers. */
const STANDALONE_LOWERCASE_VELAI = /(?<![@./a-z0-9-])\bvelai\b(?![a-z0-9.-])/;

const CODE_RESUME_MARKERS =
    /parseResume|ResumeData|parsedResume|initialParsedResume|resume-privacy|types\/resume|\bresume:/;

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

function onboardingProseLines(rel: string): string[] {
    return read(rel)
        .split("\n")
        .filter((line) => !/^\s*import /.test(line))
        .filter((line) => !CODE_RESUME_MARKERS.test(line));
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

    it("P2-10 onboarding step label reads Step N of M on every step", () => {
        const label = read("src/components/onboarding/onboarding-step-label.tsx");
        assert.match(label, /Step <span className="font-semibold tabular-nums">\{step\}<\/span> of \{total\}/);

        const landing = read("src/components/onboarding/LandingOnboardingView.tsx");
        assert.match(landing, /<OnboardingStepLabel step=\{step\} \/>/);

        const modal = read("src/components/onboarding/FirstTimeOnboardingModal.tsx");
        assert.match(modal, /<OnboardingStepLabel step=\{step\} \/>/);
    });

    it("onboarding user-visible copy uses Velai casing and résumé spelling", () => {
        for (const rel of ONBOARDING_PROSE_FILES) {
            const lines = onboardingProseLines(rel);
            for (const line of lines) {
                assert.doesNotMatch(
                    line,
                    STANDALONE_LOWERCASE_VELAI,
                    `${rel}: standalone lowercase velai in prose — use Velai`,
                );
                const withoutAccent = line.replace(/résumé/gi, "");
                assert.doesNotMatch(
                    withoutAccent,
                    /\bresumes?\b/i,
                    `${rel}: unaccented resume(s) in user-facing copy — use résumé`,
                );
            }
        }
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

    it("email-nudge mock does not nest a second main inside app shell", () => {
        const mock = read("src/components/mock/EmailNudgeMock.tsx");
        assert.match(mock, /data-testid="email-nudge-mock"/);
        assert.doesNotMatch(mock, /<main[\s>]/);
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
