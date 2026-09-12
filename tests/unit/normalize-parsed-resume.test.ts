import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeParsedResume } from "../../src/lib/resume/normalize-parsed-resume";

describe("normalizeParsedResume", () => {
    it("uses computeYearsOfExperience from dates, not model YoE", () => {
        const result = normalizeParsedResume({
            profile: {
                name: "Test User",
                profession: "Engineer",
                yearsOfExperience: 99,
            },
            experience: [
                {
                    company: "Co",
                    role: "Dev",
                    dates: "Jan 2020 - Present",
                    description: "work",
                },
            ],
        });

        // Jan 2020 → Sep 2026 ≈ 6 years — NOT 99 from the model.
        assert.ok(result.parsed.profile.yearsOfExperience >= 5);
        assert.ok(result.parsed.profile.yearsOfExperience <= 7);
        assert.notEqual(result.parsed.profile.yearsOfExperience, 99);
    });

    it("falls back to model YoE only when no parseable dates", () => {
        const result = normalizeParsedResume({
            profile: { yearsOfExperience: 4 },
            experience: [{ company: "X", role: "Y", dates: "", description: "" }],
        });
        assert.equal(result.parsed.profile.yearsOfExperience, 4);
    });

    it("normalizes literal backslash-n in descriptions", () => {
        const result = normalizeParsedResume({
            experience: [
                {
                    company: "A",
                    role: "B",
                    dates: "2020",
                    description: "• One\\n• Two",
                },
            ],
        });
        assert.match(result.parsed.experience[0].description, /\n/);
    });
});
