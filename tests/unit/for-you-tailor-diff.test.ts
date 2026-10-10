import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasMeaningfulDiff } from "../../src/lib/jobs/for-you/tailor-diff";
import { finishDraft, type TailorChange, type TailorDraft } from "../../src/lib/local-ai/tailor-resume";
import type { ResumeData } from "../../src/types/resume";

const BASE: ResumeData = {
    profile: { name: "", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "", linkedin: "" },
    experience: [{ id: "e1", company: "Acme", role: "Eng", dates: "", description: "• Built things\n• Fixed things" }],
    competencies: [{ category: "Skills", skills: ["Go", "SQL"] }],
    education: [],
    generatedSummary: "Before",
};

function mkDraft(changes: TailorChange[]): TailorDraft {
    return finishDraft({
        engineId: "heuristic",
        engineLabel: "Rules",
        usedDescription: false,
        summaryBefore: "Before",
        summaryAfter: "Before",
        bullets: [],
        base: BASE,
        changes,
        equivalents: [],
        tailored: BASE,
    });
}

describe("hasMeaningfulDiff", () => {
    it("false when the draft changes nothing", () => {
        assert.equal(hasMeaningfulDiff(mkDraft([])), false);
    });

    it("true when summary changes", () => {
        assert.equal(hasMeaningfulDiff(mkDraft([{ id: "summary", kind: "summary", before: "Before", after: "After", why: "" }])), true);
    });

    it("true when a line is reworded", () => {
        const line: TailorChange = { id: "l", kind: "line", source: "experience", entryId: "e1", index: 0, company: "Acme", role: "Eng", before: "Built things", after: "Developed things", why: "" };
        assert.equal(hasMeaningfulDiff(mkDraft([line])), true);
    });

    // The For you download sends the tailored résumé when a move is all the tailor made, not the base.
    it("true when only the order of lines or skills changes", () => {
        assert.equal(hasMeaningfulDiff(mkDraft([{ id: "o", kind: "order", source: "experience", entryId: "e1", company: "Acme", role: "Eng", order: [1, 0], why: "" }])), true);
        assert.equal(hasMeaningfulDiff(mkDraft([{ id: "s", kind: "skills", group: 0, category: "Skills", before: ["Go", "SQL"], after: ["SQL", "Go"], why: "" }])), true);
    });
});
