import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasResumeContent } from "@/lib/resume/has-content";
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

describe("hasResumeContent", () => {
    it("is false for a brand-new blank resume", () => {
        assert.equal(hasResumeContent(blankResume()), false);
    });

    it("is false when only non-content fields are filled (name/location/contact)", () => {
        assert.equal(
            hasResumeContent(
                blankResume({
                    profile: {
                        name: "Jane Doe",
                        profession: "",
                        yearsOfExperience: 0,
                        location: "NYC",
                        email: "jane@example.com",
                        phone: "555-0100",
                    },
                }),
            ),
            false,
        );
    });

    it("is true once profession is set", () => {
        assert.equal(
            hasResumeContent(
                blankResume({
                    profile: {
                        name: "",
                        profession: "Software Engineer",
                        yearsOfExperience: 0,
                        location: "",
                        email: "",
                        phone: "",
                    },
                }),
            ),
            true,
        );
    });

    it("is true once an experience entry exists", () => {
        assert.equal(
            hasResumeContent(
                blankResume({
                    experience: [{ id: "e1", company: "Acme", role: "Engineer", dates: "2020 - Present", description: "" }],
                }),
            ),
            true,
        );
    });

    it("is true once a generated summary exists", () => {
        assert.equal(hasResumeContent(blankResume({ generatedSummary: "A driven engineer." })), true);
    });
});
