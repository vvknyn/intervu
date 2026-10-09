import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPostingFreshness } from "../../src/lib/jobs/posting-freshness";
import {
    stackCardDetails,
    stackCardPlace,
    stackInferredRows,
    yearsAskedText,
} from "../../src/lib/jobs/for-you/stack-card-signals";
import { NO_SCORE_MESSAGES } from "../../src/lib/jobs/for-you/infer-reasons";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { MatchScore } from "../../src/lib/match/score";
import type { ResumeData } from "../../src/types/resume";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const DAY = 86_400_000;

function job(partial: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "1",
        title: "Senior Product Designer",
        company: "Northwind",
        company_domain: null,
        location: "Boston, MA",
        location_city: "Boston",
        location_state: "MA",
        location_country: "United States",
        work_type: "hybrid",
        description: "Design the booking flow. ".repeat(20),
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 150000,
        salary_max: 175000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: [],
        occupation: null,
        apply_url: "https://example.com/apply",
        source: "test",
        posted_at: new Date(NOW - 2 * DAY).toISOString(),
        first_seen_at: new Date(NOW - 2 * DAY).toISOString(),
        posted_ts: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "clear",
        ...partial,
    };
}

const resume = {
    profile: { profession: "Senior Product Designer" },
    experience: [{ role: "Senior Product Designer" }],
} as ResumeData;

const score: MatchScore = {
    total: 82,
    components: [
        { key: "relevance", label: "Relevance to this role", detail: "9 of 12 terms this role names", score: 1 },
        { key: "seniority", label: "Seniority", detail: "senior role — matches your senior level (set in Settings)", score: 1 },
        { key: "location", label: "Location", detail: "this role's country isn't listed", score: 0.5, unknown: true },
    ],
};

function rows(role: PublicJob, matchScore: MatchScore | null = score, cv: ResumeData | null = resume) {
    return stackInferredRows({
        job: role,
        score: matchScore,
        resume: cv,
        freshness: classifyPostingFreshness(role, NOW),
        descBlockCount: 1,
        nowMs: NOW,
    });
}

describe("stacked role card: what we inferred", () => {
    it("leads with the résumé overlap, then each compared fit component, and drops unknown ones", () => {
        const out = rows(job());
        assert.deepEqual(out.slice(0, 3), [
            { text: "Overlaps your Senior Product Designer experience.", tone: "good" },
            { text: "Relevance to this role: 9 of 12 terms this role names", tone: "good" },
            { text: "Seniority: senior role — matches your senior level (set in Settings)", tone: "good" },
        ]);
        assert.ok(!out.some((row) => /country isn't listed/.test(row.text)), "an unknown component compared nothing");
    });

    it("marks a weak component as a caution, not a match", () => {
        const weak: MatchScore = {
            total: 40,
            components: [{ key: "seniority", label: "Seniority", detail: "senior role — above your mid level (4 years of experience)", score: 0.25 }],
        };
        assert.deepEqual(
            rows(job(), weak).find((row) => row.text.startsWith("Seniority")),
            { text: "Seniority: senior role — above your mid level (4 years of experience)", tone: "caution" },
        );
    });

    it("with no score, says why instead of guessing", () => {
        const out = rows(job(), null, null);
        assert.ok(out.some((row) => row.text === NO_SCORE_MESSAGES["no-resume"] && row.tone === "neutral"));
    });

    it("states the years asked and the visa stance only when the posting gives them", () => {
        assert.equal(yearsAskedText({ min_years_experience: 5, max_years_experience: null }), "Asks for 5+ years of experience");
        assert.equal(yearsAskedText({ min_years_experience: 3, max_years_experience: 5 }), "Asks for 3 to 5 years of experience");
        assert.equal(yearsAskedText({ min_years_experience: 1 }), "Asks for 1+ year of experience");
        assert.equal(yearsAskedText({ min_years_experience: 0 }), null);
        assert.equal(yearsAskedText({ min_years_experience: 120 }), null);

        assert.ok(rows(job({ visa_sponsorship: true })).some((row) => row.text === "Sponsors visas, per the posting" && row.tone === "good"));
        assert.ok(rows(job({ visa_sponsorship: false })).some((row) => row.text === "No visa sponsorship, per the posting" && row.tone === "caution"));
        assert.ok(!rows(job({ visa_sponsorship: null })).some((row) => /visa/i.test(row.text)));
    });

    it("carries the posting checks that have a verdict: fresh is good, relisted is a caution", () => {
        assert.ok(rows(job()).some((row) => row.text === "Posted within the last 7 days" && row.tone === "good"));
        const relisted = job({
            first_seen_at: new Date(NOW - 40 * DAY).toISOString(),
            posted_at: new Date(NOW - 1 * DAY).toISOString(),
        });
        const line = rows(relisted).find((row) => row.text.startsWith("First seen by us"));
        assert.equal(line?.tone, "caution");
        assert.ok(!rows(job()).some((row) => /salary|repost/i.test(row.text)), "pay and reposts carry no verdict here");
    });

    it("never calls a role new when its posted date in the details is older than 7 days (2026-10-09)", () => {
        const foundLate = job({
            posted_at: new Date(NOW - 21 * DAY).toISOString(),
            first_seen_at: new Date(NOW - 3 * DAY).toISOString(),
        });
        const out = rows(foundLate);
        assert.ok(!out.some((row) => /within the last 7 days/.test(row.text)));
        assert.deepEqual(out.find((row) => row.text.startsWith("Posted")), { text: "Posted 21d ago", tone: "caution" });
        assert.equal(stackCardDetails(foundLate, "21d ago").find((detail) => detail.label === "Posted")?.value, "21d ago");
    });
});

describe("stacked role card: what the posting states", () => {
    it("lists only the facts the posting has, in a fixed order", () => {
        assert.deepEqual(
            stackCardDetails(job(), "2d ago").map((detail) => detail.label),
            ["Location", "Workplace", "Type", "Seniority", "Salary", "Posted"],
        );
        const sparse = job({ employment_type: undefined, experience_level: undefined, salary_min: null, salary_max: null });
        assert.deepEqual(stackCardDetails(sparse, null).map((detail) => detail.label), ["Location", "Workplace"]);
    });

    it("puts the work mode on the place line once", () => {
        assert.equal(stackCardPlace(job()), "Boston, MA · Hybrid");
        assert.match(stackCardPlace(job({ work_type: "remote" })) ?? "", /\bRemote\b/);
        assert.doesNotMatch(stackCardPlace(job({ work_type: "remote" })) ?? "", /Remote.*Remote/);
    });
});
