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
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { CONTENT_LEAD_FULL_EVIDENCE, CONTENT_LEAD_POINTS, contentLead, orderForYouJobsByBand } from "../../src/lib/jobs/for-you/band-order";
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
    it("needs an adjacent or unverified title, most of the posting covered, and terms of its own", () => {
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_EVIDENCE)), true);
        assert.equal(contentLedRole("unverified", jd(1, 20)), true);
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT - 0.01, 20)), false);
        assert.equal(contentLedRole("adjacent", jd(1, CONTENT_LED_MIN_EVIDENCE - 1)), false);
        assert.equal(contentLedRole("adjacent", jd(1)), false, "a score read before evidence existed is not content-led");
        assert.equal(contentLedRole("adjacent", undefined), false);
        for (const role of ["own", "family", "off-target"] as const) assert.equal(contentLedRole(role, jd(1, 20)), false, role);
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

    it("never lifts a different kind of role, whatever words it shares", () => {
        const score = scoreJobAgainstResume(resume, ENGINEER, signals)!;
        assert.equal(score.role, "off-target");
        assert.equal(score.contentLed, undefined);
        assert.ok(score.total < 60, `total ${score.total}`);
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
