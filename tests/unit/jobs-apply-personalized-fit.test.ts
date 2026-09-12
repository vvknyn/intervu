import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { personalizedFitFromResume } from "@/lib/jobs/apply-personalized-fit";
import type { SearchPreferences } from "@/lib/agent/preferences";
import type { ResumeData } from "@/types/resume";

const sampleResume: ResumeData = {
    profile: {
        name: "Test User",
        profession: "Technical Account Manager",
        location: "Toronto, Canada",
        yearsOfExperience: 8,
    },
    experience: [{ role: "Technical Account Manager", company: "Acme", duration: "2020–2024", highlights: [] }],
    competencies: [{ category: "Skills", skills: ["SaaS", "APIs"] }],
};

describe("personalizedFitFromResume", () => {
    it("carries salaryMin, postedBucket, work_type, and location_country from prefs", () => {
        const prefs: SearchPreferences = {
            location: "Canada",
            remoteOnly: true,
            salaryMin: 120_000,
            postedWithinDays: 7,
        };
        const result = personalizedFitFromResume(sampleResume, prefs, {});
        assert.ok(result.q.length > 0);
        assert.equal(result.sort, "fit");
        assert.equal(result.salaryMin, 120_000);
        assert.equal(result.postedBucket, "7d");
        assert.equal(result.postedExplicit, true);
        assert.deepEqual(result.facets?.work_type, ["remote"]);
        assert.deepEqual(result.facets?.location_country, ["Canada"]);
    });

    it("pref experience_level overrides résumé-derived seniority facet", () => {
        const result = personalizedFitFromResume(
            sampleResume,
            { experienceLevel: "entry" },
            {},
        );
        assert.deepEqual(result.facets?.experience_level, ["entry"]);
    });
});
