import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPreferenceChips } from "../../src/lib/jobs/for-you/preference-chips";
import type { ResumeData } from "../../src/types/resume";

describe("buildPreferenceChips", () => {
    it("prefers agent search prefs over résumé fallbacks", () => {
        const resume: ResumeData = {
            profile: {
                name: "",
                profession: "Backend Engineer",
                yearsOfExperience: 4,
                location: "London",
                email: "",
                phone: "",
                linkedin: "",
            },
            experience: [],
            competencies: [],
            education: [],
            generatedSummary: "",
        };
        const chips = buildPreferenceChips({
            search: { query: "Product Manager", location: "Berlin", salaryMin: 120_000, remoteOnly: true },
            resume,
        });
        assert.deepEqual(
            chips.map((c) => c.label),
            ["Product Manager", "Berlin", "Remote only", "$120k+"],
        );
    });

    it("falls back to résumé profession and location", () => {
        const chips = buildPreferenceChips({
            search: {},
            resume: {
                profile: {
                    name: "",
                    profession: "Designer",
                    yearsOfExperience: 2,
                    location: "Toronto",
                    email: "",
                    phone: "",
                    linkedin: "",
                },
                experience: [],
                competencies: [],
                education: [],
                generatedSummary: "",
            },
        });
        assert.deepEqual(chips.map((c) => c.key), ["role", "where"]);
    });

    it("collapses doubled Remote in the location label and skips a second remote chip", () => {
        const chips = buildPreferenceChips({
            search: { location: "Canada · Remote · Remote", remoteOnly: true },
            resume: null,
        });
        assert.deepEqual(
            chips.map((c) => c.label),
            ["Canada · Remote"],
        );
    });

    it("does not rewrite a normal location that mentions Remote only once", () => {
        const chips = buildPreferenceChips({
            search: { location: "Toronto, Canada", remoteOnly: false },
            resume: null,
        });
        assert.deepEqual(chips.map((c) => c.label), ["Toronto, Canada"]);
    });

    it("Canada plus remoteOnly still renders separate location and Remote only chips", () => {
        const chips = buildPreferenceChips({
            search: { location: "Canada", remoteOnly: true },
            resume: null,
        });
        assert.deepEqual(
            chips.map((c) => c.label),
            ["Canada", "Remote only"],
        );
    });
});
