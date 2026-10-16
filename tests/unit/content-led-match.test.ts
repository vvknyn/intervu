import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    CONTENT_LED_MIN_DUTY_EVIDENCE,
    CONTENT_LED_MIN_EVIDENCE,
    CONTENT_LED_MIN_FIT,
    MATCH_BAND_GOOD_MIN,
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

// Three postings for a different function (security operations, Salesforce administration, application support)
// that ask for what a product résumé's tool list shows: SQL, Jira, REST APIs, incident response, data, Agile.
// Their responsibilities (the days' work) are not on the résumé. Reported 2026-10-15: all three read Strong on
// his Today list under a Product Manager résumé.
const SHARED_TOOLS = ["SQL", "Jira", "REST APIs", "incident response", "data analysis", "Python", "Agile", "Confluence", "stakeholder management"];
const SECOPS = posting(
    "secops",
    "SecOps Engineer",
    "Monitor and triage security alerts in the SIEM, hunt threats with EDR tooling, run vulnerability scans and track remediation, administer Defender XDR and Sentinel, and harden cloud configurations.",
    SHARED_TOOLS,
    3,
);
const SALESFORCE_ADMIN = posting(
    "sf-admin",
    "Senior Salesforce Administrator",
    "Configure Salesforce flows, validation rules, permission sets and page layouts, build reports and dashboards, manage lead routing and sandbox releases, and train sales users on the platform.",
    SHARED_TOOLS,
    5,
);
const SUPPORT_ANALYST = posting(
    "support",
    "Application Support Analyst",
    "Work the support queue by helpdesk and phone, troubleshoot customer issues and reset accounts, document investigation notes, maintain knowledge base articles and escalate defects to development.",
    SHARED_TOOLS,
    2,
);
// Postings for the résumé's own work: a product owner's (the résumé's own kind of role) and two under titles it has
// not held ("Platform Owner", "Technical Program Lead"), whose days' work is on it.
const PRODUCT_OWNER = posting(
    "product-owner",
    "Product Owner, Payments Platform",
    "Own the roadmap and the API lifecycle for the payments platform, write requirements and user stories, run backlog grooming and prioritization with engineering, coordinate release planning from SIT through UAT to production, and lead incident command when an SLA is at risk.",
    SHARED_TOOLS,
    6,
);
const PLATFORM_OWNER = posting(
    "platform-owner",
    "Platform Owner, Payments APIs",
    "Own the roadmap and the API lifecycle for the payments platform, write requirements and user stories, run backlog grooming and prioritization with engineering, coordinate release planning from SIT through UAT to production, and lead incident command when an SLA is at risk.",
    SHARED_TOOLS,
    6,
);
const PROGRAM_LEAD = posting(
    "program-lead",
    "Technical Program Lead, Integrations",
    "Define the integration roadmap and API requirements with enterprise clients, prioritize the backlog with engineering, translate client strategy into scoped and estimated statements of work, coordinate release coordination and report adoption metrics with SQL.",
    SHARED_TOOLS,
    6,
);

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
    // `duty`: [fit, evidence] of the posting's responsibilities alone; absent = no readable responsibilities.
    const jd = (fit: number, evidence?: number, duty?: [number, number]) => ({
        fit,
        matched: [],
        missing: [],
        ...(evidence === undefined ? {} : { evidence }),
        ...(duty ? { dutyFit: duty[0], dutyEvidence: duty[1] } : {}),
    });
    const duty: [number, number] = [CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_DUTY_EVIDENCE];
    it("needs a title the résumé has not held, most of the posting covered, and terms of its own", () => {
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_EVIDENCE, duty)), true);
        assert.equal(contentLedRole("unverified", jd(1, 20, [1, 12])), true);
        assert.equal(contentLedRole("off-target", jd(CONTENT_LED_MIN_FIT, CONTENT_LED_MIN_EVIDENCE, duty)), true, "another line of work's title is not a filter either");
        assert.equal(contentLedRole("off-target", jd(CONTENT_LED_MIN_FIT - 0.01, 20, duty)), false);
        assert.equal(contentLedRole("adjacent", jd(CONTENT_LED_MIN_FIT - 0.01, 20, duty)), false);
        assert.equal(contentLedRole("adjacent", jd(1, CONTENT_LED_MIN_EVIDENCE - 1, duty)), false);
        assert.equal(contentLedRole("adjacent", jd(1)), false, "a score read before evidence existed is not content-led");
        assert.equal(contentLedRole("adjacent", undefined), false);
        for (const role of ["own", "family"] as const) assert.equal(contentLedRole(role, jd(1, 20, [1, 12])), false, role);
    });

    it("needs the posting's responsibilities to show on the résumé too, not only its requirements", () => {
        assert.equal(contentLedRole("adjacent", jd(1, 20, [CONTENT_LED_MIN_FIT - 0.01, 12])), false, "the work it asks the person to do is not on the résumé");
        assert.equal(contentLedRole("unverified", jd(1, 20, [1, CONTENT_LED_MIN_DUTY_EVIDENCE - 1])), false, "too few of its own terms in the work");
        assert.equal(contentLedRole("off-target", jd(1, 20, [CONTENT_LED_MIN_FIT - 0.01, 12])), false);
        assert.equal(contentLedRole("adjacent", jd(1, 20)), false, "a posting with no readable responsibilities is held, not content-led");
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
        assert.match(text, /title you haven't held, but the posting's day-to-day work shows on your résumé \(/);
        assert.doesNotMatch(text, /different kind of role/);
    });

    it("says why in the explanation instead of 'can't be a Strong match'", () => {
        const text = explainMatch(scoreJobAgainstResume(resume, ADJACENT, signals)!);
        assert.match(text, /title you haven't held, but the posting's day-to-day work shows on your résumé \(/);
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
        const ordered = orderForYouJobsByBand(rows, (job) => scores.get(job.id) ?? null, nowMs);
        assert.deepEqual(ordered.map((job) => job.id), ["adjacent", "thin"]);
    });

    it("leaves the bands alone: a Good never passes a Strong for its evidence", () => {
        const strong = withEvidence(0);
        const good: MatchScore = { ...withEvidence(40), total: 70 };
        const a = { ...THIN_OWN, id: "strong" };
        const b = { ...ADJACENT, id: "good" };
        const ordered = orderForYouJobsByBand([b, a], (job) => (job.id === "strong" ? strong : good), Date.now());
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

describe("a title the résumé has not held is led by the posting's day-to-day work, not its tool list", () => {
    const text = (job: PublicJob) => explainMatch(scoreJobAgainstResume(resume, job, signals)!);
    for (const job of [SECOPS, SALESFORCE_ADMIN, SUPPORT_ANALYST]) {
        it(`holds ${job.title} under Strong although its requirements share the résumé's tools`, () => {
            const score = scoreJobAgainstResume(resume, job, signals)!;
            const jd = relevance(score).jd!;
            // The old gate was met: the requirements list alone covered the posting and gave evidence of its own.
            assert.ok(jd.fit >= CONTENT_LED_MIN_FIT, `fit ${jd.fit}`);
            assert.ok((jd.evidence ?? 0) >= CONTENT_LED_MIN_EVIDENCE, `evidence ${jd.evidence}`);
            // The work it asks the person to do is not on the résumé.
            assert.ok((jd.dutyEvidence ?? 0) < CONTENT_LED_MIN_DUTY_EVIDENCE || (jd.dutyFit ?? 0) < CONTENT_LED_MIN_FIT, `duty ${jd.dutyFit} / ${jd.dutyEvidence}`);
            assert.equal(score.contentLed, undefined);
            assert.ok(score.total < MATCH_BAND_STRONG_MIN, `total ${score.total}`);
            assert.match(text(job), /can't be a Strong match|different kind of role/);
        });
    }

    for (const job of [PRODUCT_OWNER, PLATFORM_OWNER, PROGRAM_LEAD]) {
        it(`keeps ${job.title} Strong: its responsibilities are the résumé's own work`, () => {
            const score = scoreJobAgainstResume(resume, job, signals)!;
            assert.ok(score.total >= MATCH_BAND_STRONG_MIN, `total ${score.total} (${score.role})`);
            const jd = relevance(score).jd!;
            assert.ok((jd.dutyEvidence ?? 0) >= CONTENT_LED_MIN_DUTY_EVIDENCE, `duty evidence ${jd.dutyEvidence}`);
            if (score.role !== "own" && score.role !== "family") {
                assert.equal(score.contentLed, true);
                assert.match(text(job), /posting's day-to-day work shows on your résumé \(/);
            }
        });
    }

    it("does not call a posting with a requirements list and no responsibilities content-led: it is held at Good, in the list", () => {
        const description = ["About the role", "Acme is hiring a Platform Owner.", "What you bring", "6+ years of experience", ...SHARED_TOOLS.map((t) => `Experience with ${t}`)].join("\n\n");
        const job = { ...PLATFORM_OWNER, id: "no-duty", description } as PublicJob;
        const withTerms = { ...job, jd_terms: jdTermsFromDescription(description, job) } as PublicJob;
        const score = scoreJobAgainstResume(resume, withTerms, signals)!;
        assert.equal(relevance(score).jd?.dutyFit, undefined, "no responsibilities were read");
        assert.equal(score.contentLed, undefined);
        assert.ok(score.total < MATCH_BAND_STRONG_MIN, `total ${score.total}`);
    });

    // The posting with every heading taken out, as live descriptions often arrive (one run of text): its whole text is
    // not evidence of the work, so it counts toward the fit and never as the responsibilities.
    const HEADINGS = new Set(["About the role", "What you'll do", "What you bring"]);
    const flat = (job: PublicJob, id: string): PublicJob => {
        const description = job.description!.split("\n\n").filter((part) => !HEADINGS.has(part)).join(" ");
        const copy = { ...job, id, description } as PublicJob;
        return { ...copy, jd_terms: jdTermsFromDescription(description, copy) } as PublicJob;
    };

    it("does not call a posting with no readable headings content-led, though its whole text is the résumé's own work: it is held at Good", () => {
        const sectioned = scoreJobAgainstResume(resume, PLATFORM_OWNER, signals)!;
        const job = flat(PLATFORM_OWNER, "platform-owner-flat");
        const score = scoreJobAgainstResume(resume, job, signals)!;
        const jd = relevance(score).jd!;
        assert.equal(job.jd_terms?.unsectioned, true, "no heading was read");
        assert.ok(jd.fit >= CONTENT_LED_MIN_FIT, `the whole text still covers the résumé: fit ${jd.fit}`);
        assert.equal(jd.dutyFit, undefined, "no responsibilities were read");
        assert.equal(score.contentLed, undefined);
        assert.equal(score.total, MATCH_BAND_STRONG_MIN - 1, "held at the top of Good");
        assert.ok(score.total >= MATCH_BAND_GOOD_MIN);
        assert.match(explainMatch(score), /can't be a Strong match|different kind of role/);
        // Only the flat text is held: the same posting with its headings reads Strong, content-led or by its role.
        assert.ok(sectioned.total >= MATCH_BAND_STRONG_MIN, `sectioned total ${sectioned.total}`);
    });

    it("leaves a role the résumé holds Strong on the same headingless text", () => {
        const unheld = flat(PLATFORM_OWNER, "platform-owner-flat");
        const ownTitled = { ...unheld, id: "product-owner-flat", title: PRODUCT_OWNER.title } as PublicJob;
        const job = { ...ownTitled, jd_terms: jdTermsFromDescription(ownTitled.description, ownTitled) } as PublicJob;
        const score = scoreJobAgainstResume(resume, job, signals)!;
        assert.ok(score.role === "own" || score.role === "family", score.role);
        assert.equal(job.jd_terms?.unsectioned, true);
        assert.ok(score.total >= MATCH_BAND_STRONG_MIN, `total ${score.total}`);
    });
});
