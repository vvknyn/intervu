import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mergeModelIntoHeuristic } from "../../src/lib/local-ai/parse-resume";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

describe("mergeModelIntoHeuristic", () => {
    it("empty model object does not clobber heuristic name, email, or experience", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {},
        );

        assert.equal(usedHeuristic, true);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.email, "jane.doe@example.com");
        assert.ok((raw.experience?.length ?? 0) >= 2);
    });

    it("empty-string profile fields from model do not overwrite heuristic values", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {
                profile: {
                    name: "",
                    email: "",
                    profession: "   ",
                    phone: "",
                },
                experience: [{ company: "", role: "" }],
                competencies: [{ category: "Skills", skills: [""] }],
                education: [{ degree: "", institution: "" }],
                generatedSummary: "",
            },
        );

        assert.equal(usedHeuristic, true);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.email, "jane.doe@example.com");
        assert.equal(raw.profile?.profession, "Senior Software Engineer");
        assert.ok((raw.experience?.length ?? 0) >= 2);
    });

    it("merges non-empty model fields and marks model as contributor", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {
                profile: { location: "Boston, MA" },
                generatedSummary: "Strong backend engineer with platform focus.",
            },
        );

        assert.equal(usedHeuristic, false);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.location, "Boston, MA");
        assert.equal(raw.generatedSummary, "Strong backend engineer with platform focus.");
    });
});
