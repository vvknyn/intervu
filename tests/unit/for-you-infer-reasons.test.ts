import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferReasons } from "../../src/lib/jobs/for-you/infer-reasons";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

function mkJob(fields: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "job-1",
        title: "Software Engineer",
        company: "Acme",
        location: "Remote",
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: ["javascript", "react"],
        apply_url: "https://example.com",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...fields,
    } as PublicJob;
}

function mkResume(): ResumeData {
    return {
        profile: {
            name: "Alex",
            profession: "Software Engineer",
            yearsOfExperience: 5,
            location: "US",
            email: "",
            phone: "",
            linkedin: "",
        },
        experience: [{ id: "e1", company: "Beta", role: "Software Engineer", dates: "2020–2024", description: "" }],
        competencies: [{ category: "Skills", skills: ["JavaScript", "React"] }],
        education: [],
        generatedSummary: "",
    };
}

describe("inferReasons", () => {
    it("does not restate match score component details as bullets (they already render in the Fit breakdown)", () => {
        const score: MatchScore = {
            total: 82,
            components: [
                { key: "relevance", label: "Relevance", detail: "8 of 10 terms this role names", score: 0.8 },
                { key: "seniority", label: "Seniority", detail: "mid — fits", score: 1 },
            ],
        };
        const result = inferReasons(mkJob(), score, mkResume());
        assert.ok(!result.bullets.some((b) => b.includes("8 of 10")));
        assert.ok(!result.bullets.some((b) => b.includes("mid — fits")));
        // Resume overlaps this job's title, so bullets still carry distinct evidence.
        assert.ok(result.bullets.some((b) => b.toLowerCase().includes("title overlap")));
        assert.ok(result.chips.length > 0);
    });

    it("never lets a bullet duplicate any Fit breakdown component detail, for any component values (class-wide, not name-matched)", () => {
        const score: MatchScore = {
            total: 54,
            components: [
                { key: "relevance", label: "Relevance", detail: "3 of 6 keywords found in this listing", score: 0.5 },
                { key: "location", label: "Location", detail: "different country — may need relocation", score: 0.6 },
            ],
        };
        const result = inferReasons(mkJob({ title: "Backend Developer" }), score, mkResume());
        const breakdownDetails = new Set(score.components.map((c) => c.detail));
        for (const bullet of result.bullets) {
            assert.ok(
                !breakdownDetails.has(bullet),
                `bullet "${bullet}" duplicates a string already rendered in the Fit breakdown`,
            );
        }
    });

    it("still surfaces resume-based bullets when there is no matchScore", () => {
        const result = inferReasons(mkJob(), null, mkResume());
        assert.ok(result.bullets.some((b) => b.toLowerCase().includes("title overlap")));
    });

    it("stays honest when nothing comparable exists", () => {
        const result = inferReasons(mkJob({ title: "Chef" }), null, null);
        assert.ok(result.bullets.some((b) => b.toLowerCase().includes("résumé")));
    });
});
