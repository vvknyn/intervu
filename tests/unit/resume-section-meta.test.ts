import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sectionMetaLabel } from "@/lib/resume/section-meta";
import type { ResumeData } from "@/types/resume";

function blankResume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: {
            name: "",
            profession: "",
            yearsOfExperience: 0,
            location: "",
            email: "",
            phone: "",
        },
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: "",
        ...overrides,
    };
}

describe("sectionMetaLabel", () => {
    it("has no meta for summary/projects — no countable fact to show", () => {
        const data = blankResume({ experience: [{ id: "1", company: "Acme", role: "Eng", dates: "", description: "" }] });
        assert.equal(sectionMetaLabel("summary", data), undefined);
        assert.equal(sectionMetaLabel("projects", data), undefined);
    });

    it("counts experience roles, singular vs plural", () => {
        const one = blankResume({ experience: [{ id: "1", company: "Acme", role: "Eng", dates: "", description: "" }] });
        assert.equal(sectionMetaLabel("experience", one), "1 role");

        const two = blankResume({
            experience: [
                { id: "1", company: "Acme", role: "Eng", dates: "", description: "" },
                { id: "2", company: "Beta", role: "PM", dates: "", description: "" },
            ],
        });
        assert.equal(sectionMetaLabel("experience", two), "2 roles");
    });

    it("is undefined (degrades by omission) when experience is empty", () => {
        assert.equal(sectionMetaLabel("experience", blankResume()), undefined);
    });

    it("sums skills across every competency category, not just the first", () => {
        const data = blankResume({
            competencies: [
                { category: "Leadership", skills: ["Coaching", "Delegation"] },
                { category: "Technical", skills: ["TypeScript"] },
            ],
        });
        assert.equal(sectionMetaLabel("skills", data), "3 skills");
    });

    it("counts education entries, singular vs plural", () => {
        const data = blankResume({ education: [{ id: "1", degree: "BS", institution: "MIT", year: "2020" }] });
        assert.equal(sectionMetaLabel("education", data), "1 entry");
    });
});
