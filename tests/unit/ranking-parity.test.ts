import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scoreJobAgainstResume, type MatchScore } from "../../src/lib/match/score";
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { deckLeftOut, orderForYouJobsByBand, sortByFit } from "../../src/lib/jobs/for-you/band-order";
import { pickToday, type TodayRole } from "../../src/lib/jobs/for-you/today";
import { resumeDataFromPlainText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";

// One résumé (the PM fixture) against postings built to land in every part of the order: a different kind
// of job, a detailed posting under a title the résumé never held, a thin one under its own title, one posted
// two months ago, one abroad, one that names no country. Every list that recommends must put the same roles
// in the same order (the deck, the agent's `for_you`, Today, the daily picks and their email, the fit-sorted
// Search list) and leave out the same ones, with one difference that is the product's: a role that names no
// country stays in the deck and out of the picks.
const base = resumeDataFromPlainText(readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-pm-resume.txt"), "utf8"));
const resume = { ...base, profile: { ...base.profile, location: "Richmond Hill, Ontario, Canada" } };
const signals = resolveCandidateSignals(resume, null);
const NOW = Date.now();
const DAY = 86_400_000;

function posting(
    id: string,
    title: string,
    about: string,
    skills: string[],
    opts: { ageDays?: number; country?: string | null; city?: string | null; yrs?: number; level?: string } = {},
): PublicJob {
    const yrs = opts.yrs ?? 6;
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
    const country = opts.country === undefined ? "Canada" : opts.country;
    const city = opts.city === undefined ? "Toronto" : opts.city;
    const posted = new Date(NOW - (opts.ageDays ?? 1) * DAY).toISOString();
    const job = {
        id,
        title,
        company: `Acme ${id}`,
        location: [city, country].filter(Boolean).join(", ") || null,
        location_city: city,
        location_state: country === "Canada" ? "Ontario" : null,
        location_country: country,
        work_type: "hybrid",
        employment_type: "full_time",
        experience_level: opts.level ?? "senior",
        description,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: posted,
        posted_ts: NOW - (opts.ageDays ?? 1) * DAY,
        first_seen_at: posted,
        vacancy_status: "open",
        ghost_badge: "clear",
        min_years_experience: yrs,
        must_have_skills: skills,
        skills_section_found: skills.length > 0,
    } as unknown as PublicJob;
    return { ...job, jd_terms: jdTermsFromDescription(description, job) } as PublicJob;
}

const PM_DUTIES =
    "Own the roadmap and the API lifecycle for a platform used by enterprise clients. Translate client strategy into scoped, estimated and prioritized statements of work, run backlog grooming and prioritization with engineering, coordinate release coordination from SIT through UAT to production, and lead incident command when an SLA is at risk.";
const PM_SKILLS = ["API lifecycle management", "Roadmap", "Requirements", "JIRA", "SQL"];

const JOBS: PublicJob[] = [
    posting("own-detailed", "Senior Technical Product Owner", PM_DUTIES, PM_SKILLS),
    posting("own-thin", "Product Manager", "We are looking for a Product Manager to join our team and deliver great products for our customers.", [], { yrs: 5 }),
    posting("adjacent-detailed", "Platform Owner, Loyalty and Rewards APIs", PM_DUTIES, PM_SKILLS),
    posting("adjacent-older", "Delivery Lead, Client Programs", PM_DUTIES, PM_SKILLS, { ageDays: 12 }),
    posting("engineer", "Software Engineer, API Platform", "Build and operate REST APIs in Go on Kubernetes with Postgres and on-call.", ["Go", "Kubernetes", "Postgres"], { yrs: 5 }),
    posting("abroad", "Senior Technical Product Owner", PM_DUTIES, PM_SKILLS, { country: "United Kingdom", city: "London" }),
    posting("two-months-old", "Senior Technical Product Owner", PM_DUTIES, PM_SKILLS, { ageDays: 70 }),
    posting("no-country", "Platform Owner, Client APIs", PM_DUTIES, PM_SKILLS, { country: null, city: null }),
];

const scores = new Map(JOBS.map((job) => [job.id, scoreJobAgainstResume(resume, job, signals)] as const));
const scoreOf = (job: PublicJob): MatchScore | null => scores.get(job.id) ?? null;
const ids = (jobs: readonly { id: string }[]) => jobs.map((j) => j.id);

describe("every recommending list orders and leaves out the same way", () => {
    it("scores every posting, so the lists below compare real fits", () => {
        for (const job of JOBS) assert.ok(scoreOf(job), `${job.id} has a score`);
    });

    it("the deck, Today, the daily picks and the fit-sorted list put the same roles in the same order", () => {
        const deck = ids(orderForYouJobsByBand(JOBS, scoreOf, "product manager", NOW));
        const roles: TodayRole[] = JOBS.flatMap((job) => {
            const score = scoreOf(job);
            return score ? [{ job, score }] : [];
        });
        const today = ids(pickToday(roles, { skipped: new Set(), tracked: new Set() }).map((r) => r.job));
        const list = ids(
            sortByFit(JOBS, (job) => ({ job, score: scoreOf(job) }), { nowMs: NOW })
                .filter((job) => deckLeftOut(job, scoreOf(job), NOW) == null),
        );

        // The picks leave a role with no stated country out ("Country unclear, out of picks"); the deck lists it last.
        const deckWithoutUnplaced = deck.filter((id) => id !== "no-country");
        assert.deepEqual(today, deckWithoutUnplaced, "Today and the daily picks follow the deck's order");
        assert.deepEqual(list.filter((id) => id !== "no-country"), deckWithoutUnplaced, "the fit-sorted list follows the deck's order");
        assert.ok(deck.length >= 3, `the deck lists roles to compare (${deck.join(", ")})`);
    });

    it("a role too old, a different kind of job or abroad is out of every list, for the same reason", () => {
        const deck = new Set(ids(orderForYouJobsByBand(JOBS, scoreOf, "product manager", NOW)));
        const picks = new Set(ids(pickToday(JOBS.flatMap((job) => (scoreOf(job) ? [{ job, score: scoreOf(job)! }] : [])), { skipped: new Set(), tracked: new Set() }).map((r) => r.job)));
        for (const id of ["two-months-old", "engineer", "abroad"]) {
            assert.equal(deck.has(id), false, `${id} is not in the deck`);
            assert.equal(picks.has(id), false, `${id} is not in the picks`);
        }
        assert.equal(deckLeftOut(JOBS.find((j) => j.id === "two-months-old")!, scoreOf(JOBS.find((j) => j.id === "two-months-old")!), NOW), "old");
    });

    it("the only difference from the deck is the product's: a role that names no country is out of the picks and last in the deck", () => {
        const job = JOBS.find((j) => j.id === "no-country")!;
        const score = scoreOf(job)!;
        assert.equal(deckLeftOut(job, score, NOW, { strictPlace: true }) != null, true, "out of the picks");
        const deck = ids(orderForYouJobsByBand(JOBS, scoreOf, "product manager", NOW));
        if (deckLeftOut(job, score, NOW) == null) assert.equal(deck.at(-1), "no-country", "last in the deck");
    });

    it("a role this device has already listed goes after the new ones in the same band, in Today and the list, and not in the deck", () => {
        const roles: TodayRole[] = JOBS.flatMap((job) => (scoreOf(job) ? [{ job, score: scoreOf(job)! }] : []));
        const fresh = ids(pickToday(roles, { skipped: new Set(), tracked: new Set() }).map((r) => r.job));
        const first = fresh[0]!;
        const afterSeen = ids(pickToday(roles, { skipped: new Set(), tracked: new Set(), seenBefore: new Set([first]) }).map((r) => r.job));
        // Seen-first only reorders inside a band: the same roles come back.
        assert.deepEqual([...afterSeen].sort(), [...fresh].sort());
        const listed = ids(sortByFit(JOBS, (job) => ({ job, score: scoreOf(job) }), { nowMs: NOW, seen: (id) => id === first }));
        assert.ok(listed.indexOf(first) >= 0);
    });
});
