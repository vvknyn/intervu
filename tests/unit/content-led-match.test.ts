import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    CONTENT_LED_MIN_EVIDENCE,
    CONTENT_LED_MIN_FIT,
    MATCH_BAND_STRONG_MIN,
    contentLedRole,
    scoreJobAgainstResume,
    specificEvidence,
    specificTerms,
    type MatchScore,
} from "../../src/lib/match/score";
import { explainMatch } from "../../src/lib/match/explain";
import { forYouLeftOut } from "../../src/lib/jobs/for-you/left-out";
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { CONTENT_LEAD_FULL_EVIDENCE, CONTENT_LEAD_POINTS, compareForYouKeys, contentLead, forYouSortKey, orderForYouJobsByBand } from "../../src/lib/jobs/for-you/band-order";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";

// The PM résumé (13 years, senior technical product owner) and postings CONSTRUCTED for this test: one
// whose title the résumé has never held but whose body asks for what it shows, a generic two-line one
// under the résumé's own title, and a different kind of job that shares words.
const base = resumeDataFromPlainText(readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-pm-resume.txt"), "utf8"));
const resume = { ...base, profile: { ...base.profile, location: "Richmond Hill, Ontario, Canada" } };
const signals = resolveCandidateSignals(resume, null);

function posting(id: string, title: string, about: string, skills: string[], yrs = 6): PublicJob {
    const description = [
        "About the role",
        `Acme is hiring a ${title}.`,
        "What you'll do",
        about,
        "What you bring",
        `${yrs}+ years of experience`,
        ...skills.map((s) => `Experience with ${s}`),
        "We are an equal opportunity employer.",
    ].join("\n\n");
    const job = {
        id,
        title,
        company: "Acme",
        location: "Toronto, Ontario, Canada",
        location_city: "Toronto",
        location_state: "Ontario",
        location_country: "Canada",
        work_type: "hybrid",
        employment_type: "full_time",
        experience_level: "senior",
        description,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: new Date().toISOString(),
        vacancy_status: "open",
        ghost_badge: "clear",
        min_years_experience: yrs,
        must_have_skills: skills,
        skills_section_found: skills.length > 0,
    } as unknown as PublicJob;
    return { ...job, jd_terms: jdTermsFromDescription(description, job) } as PublicJob;
}

const ADJACENT = posting(
    "adjacent",
    "Platform Owner, Loyalty and Rewards APIs",
    "Own the roadmap and the API lifecycle for a loyalty and rewards platform used by enterprise health and wellbeing clients. Translate client strategy into scoped, estimated and prioritized statements of work, run backlog grooming and prioritization with engineering, coordinate release coordination from SIT through UAT to production, and lead incident command when an SLA is at risk.",
    ["API lifecycle management", "Roadmap", "Requirements", "JIRA", "SQL"],
);
const THIN_OWN = posting(
    "thin",
    "Product Manager",
    "We are looking for a Product Manager to join our team. You will work with a variety of stakeholders to deliver great products for our customers and grow with a fast-moving company.",
    [],
    5,
);
const ENGINEER = posting(
    "engineer",
    "Software Engineer, API Platform",
    "Build and operate REST APIs and data pipelines in Go on Kubernetes with Postgres. Own services end to end, participate in incident response and on-call, and improve observability and reliability.",
    ["Go", "Kubernetes", "REST APIs", "Postgres"],
    5,
);
// An engineer-titled posting (another line of work for a product résumé) whose body is the adjacent one's: the same asks.
const ENGINEER_ASKING = posting("engineer-asking", "Software Engineer, Loyalty and Rewards APIs", ADJACENT.description!.split("\n\n")[3]!, ["API lifecycle management", "Roadmap", "Requirements", "JIRA", "SQL"]);
// The adjacent posting with its body cut to the title's own words: nothing it asks that the résumé could show.
const ADJACENT_THIN = posting("adjacent-thin", "Platform Owner, Loyalty and Rewards APIs", "Join the platform owner team for loyalty and rewards.", [], 6);

const relevance = (score: MatchScore) => score.components.find((c) => c.key === "relevance")!;

describe("specificEvidence", () => {
    it("leaves out the terms that are only the posting's own title words", () => {
        const matched = ["product manager", "roadmap", "backlog grooming", "managers"];
        assert.deepEqual(specificTerms(matched, { title: "Senior Product Manager" }), ["roadmap", "backlog grooming"]);
        assert.equal(specificEvidence(matched, { title: "Senior Product Manager" }), 2);
        assert.equal(specificEvidence(matched, { title: "Delivery Lead" }), 4);
        assert.equal(specificEvidence([], { title: "Delivery Lead" }), 0);
    });
});

describe("contentLedRole", () => {
    const jd = (fit: number, evidence?: number) => ({ fit, matched: [], missing: [], ...(evidence === undefined ? {} : { evidence }) });
    it("needs a title the résumé has not held, most of the posting covered, and terms of its own", () => {
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_EVIDENCE)), true);
        assert.equal(contentLedRole("unverified", jd(1, 20)), true);
        assert.equal(contentLedRole("off-target", jd(CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_EVIDENCE)), true, "another line of work's title is not a filter either");
        assert.equal(contentLedRole("off-target", jd(CONTENT_LED_MIN_FIT - 0.01, 20)), false);
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT - 0.01, 20)), false);
        assert.equal(contentLedRole("adjacent", jd(1, CONTENT_LED_MIN_EVIDENCE - 1)), false);
        assert.equal(contentLedRole("adjacent", jd(1)), false, "a score read before evidence existed is not content-led");
        assert.equal(contentLedRole("adjacent", undefined), false);
        for (const role of ["own", "family"] as const) assert.equal(contentLedRole(role, jd(1, 20)), false, role);
    });
});

describe("a title the résumé has not held whose posting asks for what it shows", () => {
    it("reads Strong, flagged content-led, with evidence of its own", () => {
        const score = scoreJobAgainstResume(resume, ADJACENT, signals)!;
        assert.ok(score.role === "adjacent" || score.role === "unverified", `role ${score.role}`);
        assert.equal(score.contentLed, true);
        assert.ok(score.total >= MATCH_BAND_STRONG_MIN, `total ${score.total}`);
        assert.ok((relevance(score).jd?.evidence ?? 0) >= CONTENT_LED_MIN_EVIDENCE);
        assert.ok((relevance(score).jd?.evidenceTerms ?? []).length > 0);
    });

    it("is still held under Strong when the posting says nothing the résumé could show", () => {
        const score = scoreJobAgainstResume(resume, ADJACENT_THIN, signals)!;
        assert.equal(score.contentLed, undefined);
        assert.ok(score.total < MATCH_BAND_STRONG_MIN, `total ${score.total}`);
    });

    it("holds a different kind of role that only shares some words, as a Stretch that is left out", () => {
        const score = scoreJobAgainstResume(resume, ENGINEER, signals)!;
        assert.equal(score.role, "off-target");
        assert.equal(score.contentLed, undefined);
        assert.ok(score.total < 60, `total ${score.total}`);
        assert.equal(forYouLeftOut(score), "other-role");
    });

    it("does not hold another line of work's title when its posting asks for what the résumé shows: content decides, the title only orders", () => {
        const score = scoreJobAgainstResume(resume, ENGINEER_ASKING, signals)!;
        assert.equal(score.role, "off-target", "its title is still another line of work's");
        assert.equal(score.contentLed, true);
        assert.ok(score.total >= MATCH_BAND_STRONG_MIN, `total ${score.total}`);
        assert.equal(forYouLeftOut(score), null);
        const text = explainMatch(score);
        assert.match(text, /title you haven't held, but the posting asks for what your résumé shows \(/);
        assert.doesNotMatch(text, /different kind of role/);
    });

    it("says why in the explanation instead of 'can't be a Strong match'", () => {
        const text = explainMatch(scoreJobAgainstResume(resume, ADJACENT, signals)!);
        assert.match(text, /title you haven't held, but the posting asks for what your résumé shows \(/);
        assert.doesNotMatch(text, /can't be a Strong match/);
        // The unchanged roles keep their sentence.
        assert.match(explainMatch(scoreJobAgainstResume(resume, ADJACENT_THIN, signals)!), /can't be a Strong match/);
    });
});

describe("a posting that is only its title, under the résumé's own title", () => {
    it("has no evidence of its own, though it reads as full a fit as a detailed one", () => {
        const thin = scoreJobAgainstResume(resume, THIN_OWN, signals)!;
        const detailed = scoreJobAgainstResume(resume, ADJACENT, signals)!;
        assert.equal(relevance(thin).jd?.evidence, 0);
        assert.ok(relevance(thin).jd!.fit >= 0.95, "the fit alone cannot tell them apart");
        assert.ok(relevance(detailed).jd!.evidence! > relevance(thin).jd!.evidence!);
    });
});

describe("contentLead", () => {
    const withEvidence = (evidence?: number): MatchScore => ({
        total: 100,
        components: [{ key: "relevance", label: "Relevance", detail: "", score: 1, ...(evidence === undefined ? {} : { jd: { fit: 1, matched: [], missing: [], evidence } }) }],
    });

    it("grows with the evidence up to a cap, and is nothing for a score without it", () => {
        assert.equal(contentLead(withEvidence(0)), 0);
        assert.equal(contentLead(withEvidence()), 0);
        assert.equal(contentLead(withEvidence(CONTENT_LEAD_FULL_EVIDENCE / 2)), CONTENT_LEAD_POINTS / 2);
        assert.equal(contentLead(withEvidence(CONTENT_LEAD_FULL_EVIDENCE)), CONTENT_LEAD_POINTS);
        assert.equal(contentLead(withEvidence(CONTENT_LEAD_FULL_EVIDENCE * 3)), CONTENT_LEAD_POINTS);
    });

    it("puts a detailed posting ahead of a generic one inside a band, even when the generic one carries the own-role lift", () => {
        const rows = [THIN_OWN, ADJACENT];
        const scores = new Map(rows.map((job) => [job.id, scoreJobAgainstResume(resume, job, signals)!] as const));
        assert.equal(scores.get("thin")!.role, "own");
        const nowMs = Date.now();
        const ordered = orderForYouJobsByBand(rows, (job) => scores.get(job.id) ?? null, "product manager", nowMs);
        assert.deepEqual(ordered.map((job) => job.id), ["adjacent", "thin"]);
    });

    it("leaves the bands alone: a Good never passes a Strong for its evidence", () => {
        const strong = withEvidence(0);
        const good: MatchScore = { ...withEvidence(40), total: 70 };
        const a = { ...THIN_OWN, id: "strong" };
        const b = { ...ADJACENT, id: "good" };
        const ordered = orderForYouJobsByBand([b, a], (job) => (job.id === "strong" ? strong : good), "product manager", Date.now());
        assert.deepEqual(ordered.map((job) => job.id), ["strong", "good"]);
    });
});

describe("the title comes last", () => {
    const sameAs = (title: string, id: string): PublicJob => ({ ...ADJACENT, id, title });

    it("scores the content alone once the posting is read: two titles over the same posting read the same relevance", () => {
        const a = scoreJobAgainstResume(resume, sameAs("Platform Owner, Loyalty and Rewards APIs", "a"), signals)!;
        const b = scoreJobAgainstResume(resume, sameAs("Rewards Program Lead", "b"), signals)!;
        assert.equal(relevance(a).score, relevance(b).score);
        assert.equal(a.total, b.total);
    });

    it("lifts the résumé's own role only among roles whose rounded fit is equal", () => {
        const key = (over: Partial<MatchScore>, evidence = 10): MatchScore => ({
            total: 80,
            components: [{ key: "relevance", label: "Relevance", detail: "", score: 0.8, jd: { fit: 1, matched: [], missing: [], evidence } }],
            ...over,
        });
        const nowMs = Date.now();
        const sortOf = (score: MatchScore) => forYouSortKey(score, nowMs - 3 * 86_400_000, nowMs);
        // Equal fit: the own role leads, then the family, then the rest.
        const [own, family, other] = [sortOf(key({ role: "own" })), sortOf(key({ role: "family" })), sortOf(key({ role: "adjacent" }))];
        assert.ok(compareForYouKeys(own, family) < 0 && compareForYouKeys(family, other) < 0);
        // A role that fits a point better leads whatever its title: the lift is a tie-break, not a credit.
        const better = sortOf(key({ role: "adjacent", total: 82 }));
        assert.ok(compareForYouKeys(better, own) < 0, `${JSON.stringify(better)} vs ${JSON.stringify(own)}`);
        // What the posting asks for that the résumé shows leads the title too.
        const detailed = sortOf(key({ role: "adjacent" }, 16));
        assert.ok(compareForYouKeys(detailed, own) < 0);
    });
});
