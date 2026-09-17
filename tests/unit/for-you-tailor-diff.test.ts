import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasMeaningfulDiff } from "../../src/lib/jobs/for-you/tailor-diff";
import type { TailorDraft } from "../../src/lib/local-ai/tailor-resume";

function mkDraft(partial: Partial<TailorDraft>): TailorDraft {
    return {
        engineId: "heuristic",
        engineLabel: "Rules",
        usedDescription: false,
        summaryBefore: "Before",
        summaryAfter: "Before",
        bullets: [],
        tailored: {
            profile: {
                name: "",
                profession: "",
                yearsOfExperience: 0,
                location: "",
                email: "",
                phone: "",
                linkedin: "",
            },
            experience: [],
            competencies: [],
            education: [],
            generatedSummary: "",
        },
        ...partial,
    };
}

describe("hasMeaningfulDiff", () => {
    it("false when summary unchanged and no bullet diffs", () => {
        assert.equal(hasMeaningfulDiff(mkDraft({})), false);
    });

    it("true when summary changes", () => {
        assert.equal(hasMeaningfulDiff(mkDraft({ summaryAfter: "After" })), true);
    });

    it("true when bullet diffs exist", () => {
        assert.equal(
            hasMeaningfulDiff(
                mkDraft({
                    bullets: [
                        {
                            experienceId: "e1",
                            source: "experience",
                            company: "Acme",
                            role: "Eng",
                            before: "Built things",
                            after: "Built scalable things",
                        },
                    ],
                }),
            ),
            true,
        );
    });
});
