import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    canAcceptLocalParse,
    LOCAL_PARSE_COMPLETE_MIN,
    missingMatchFields,
    scoreLocalParseConfidence,
} from "../../src/lib/local-ai/parse-confidence";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

function coreFourBase() {
    return {
        profile: {
            name: "Jane Doe",
            profession: "Senior Software Engineer",
            yearsOfExperience: 8,
            location: "",
            email: "",
            phone: "",
            linkedin: "",
        },
        experience: [
            {
                id: "exp-1",
                company: "Acme Corp",
                role: "Senior Software Engineer",
                dates: "Jan 2020 - Present",
                description: "Led platform work",
            },
            {
                id: "exp-2",
                company: "Beta Systems",
                role: "Software Engineer",
                dates: "Mar 2016 - Dec 2019",
                description: "Built APIs",
            },
        ],
        competencies: [{ category: "Skills", skills: ["JavaScript", "TypeScript", "React"] }],
        education: [],
        generatedSummary:
            "Experienced software engineer with 8+ years building scalable web platforms.",
    };
}

describe("scoreLocalParseConfidence", () => {
    it("scores clean complete fixture ≥ 91", () => {
        const structured = structureResumeText(FIXTURE);
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.overall >= LOCAL_PARSE_COMPLETE_MIN, `expected ≥ ${LOCAL_PARSE_COMPLETE_MIN}, got ${score.overall}`);
        assert.ok(canAcceptLocalParse(structured));
    });

    it("missing name → ≤ 90", () => {
        const structured = structureResumeText(FIXTURE);
        structured.profile = { ...structured.profile, name: "" };
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.overall <= 90);
        // A name doesn't rank jobs: the read still goes on.
        assert.ok(canAcceptLocalParse(structured));
    });

    it("missing profession → ≤ 90", () => {
        const structured = structureResumeText(FIXTURE);
        structured.profile = { ...structured.profile, profession: "" };
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.overall <= 90);
        // The roles in its work history still name a job title.
        assert.ok(canAcceptLocalParse(structured));
    });

    it("no experience → ≤ 90", () => {
        const structured = structureResumeText(FIXTURE);
        structured.experience = [];
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.overall <= 90);
        assert.ok(canAcceptLocalParse(structured));
        assert.deepEqual(missingMatchFields(structured), ["work history"]);
    });

    it("no skills → ≤ 90", () => {
        const structured = structureResumeText(FIXTURE);
        structured.competencies = [];
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.overall <= 90);
        assert.ok(canAcceptLocalParse(structured));
        assert.deepEqual(missingMatchFields(structured), ["skills"]);
    });

    it("core four without email or education → ≤ 90", () => {
        const score = scoreLocalParseConfidence(coreFourBase());
        assert.equal(score.overall, 90);
        // No email and no education used to block ranking at 90.
        assert.ok(canAcceptLocalParse(coreFourBase()));
        assert.deepEqual(missingMatchFields(coreFourBase()), []);
    });

    it("core four + email → ≥ 91", () => {
        const data = coreFourBase();
        data.profile.email = "jane.doe@example.com";
        const score = scoreLocalParseConfidence(data);
        assert.ok(score.overall >= LOCAL_PARSE_COMPLETE_MIN);
        assert.ok(canAcceptLocalParse(data));
    });

    it("name and email only stays well below 90 and can't rank jobs", () => {
        const data = {
            profile: {
                name: "Jane Doe",
                profession: "",
                yearsOfExperience: 0,
                location: "",
                email: "jane@example.com",
                phone: "",
                linkedin: "",
            },
            experience: [],
            competencies: [],
            education: [],
            generatedSummary: "",
        };
        const score = scoreLocalParseConfidence(data);
        assert.ok(score.overall < 70);
        assert.equal(canAcceptLocalParse(data), false);
        assert.deepEqual(missingMatchFields(data), ["job title", "work history", "skills"]);
    });

    it("a read with only a skill, or only a role, can rank jobs", () => {
        const base = coreFourBase();
        const skillOnly = { ...base, profile: { ...base.profile, profession: "" }, experience: [] };
        assert.ok(canAcceptLocalParse(skillOnly));
        assert.deepEqual(missingMatchFields(skillOnly), ["job title", "work history"]);
        const roleOnly = { ...base, profile: { ...base.profile, profession: "" }, competencies: [] };
        assert.ok(canAcceptLocalParse(roleOnly));
        assert.deepEqual(missingMatchFields(roleOnly), ["skills"]);
    });

    it("computes per-section scores independently of overall", () => {
        const structured = structureResumeText(FIXTURE);
        const score = scoreLocalParseConfidence(structured);
        assert.ok(score.profile >= 90);
        assert.ok(score.experience >= 90);
        assert.ok(score.competencies >= 90);
        assert.ok(score.education >= 90);
        assert.ok(score.summary >= 90);
    });
});
