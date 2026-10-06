/**
 * A role tied to another country never passes as workable: from its title
 * ("Technical Account Manager (India)"), its place fields ("Remote (US
 * only)") or its description ("must be based in India"), for any country,
 * and whether or not the candidate asked for remote work only (2026-10-02:
 * a remote-only résumé in Canada got an India-only TAM role as a Today pick).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { AgentPreferences } from "@/lib/agent/preferences";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import { pickToday, placeCheckIds, todayLeftOut, withPlaceNotes, type TodayRole } from "@/lib/jobs/for-you/today";
import { MAX_LATE_PLACE_READS, SEARCH_PLACE_READ_MAX_IDS, withDescriptionPlace, withPlaceRestrictions } from "@/lib/jobs/place-notes";
import { needsPlaceCheck, nextPlaceCheckIds, OPEN_ANYWHERE, readPlaceRestriction } from "@/lib/jobs/place-restriction";
import { jobCountries, placeNamed, titlePlace } from "@/lib/jobs/resume-location";
import type { PublicJob } from "@/lib/jobs/types";
import { explainMatch } from "@/lib/match/explain";
import { scoreJobAgainstResume } from "@/lib/match/score";
import { resumeDataFromPlainText, structureResumeText } from "@/lib/resume/structure-resume-text";
import type { ResumeData } from "@/types/resume";
import { mkJob } from "../support/jobs-corpus-stub";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), "utf8");
const golden = (name: string): ResumeData => structureResumeText(fixture(name).replace(/'/g, "’")) as ResumeData;
const at = (resume: ResumeData, location: string): ResumeData => ({ ...resume, profile: { ...resume.profile, location } });

const TAM_TORONTO = at(resumeDataFromPlainText(fixture("vivek-tam-resume")), "Toronto, Ontario");
const RN_TORONTO = at(golden("health-rn-resume"), "Toronto, Ontario");
const SWE_LONDON = at(golden("sample-resume"), "London, United Kingdom");
const SWE_BENGALURU = at(golden("sample-resume"), "Bengaluru, India");

const REMOTE_ONLY = { configured: true, search: { remoteOnly: true }, answers: {} } as unknown as AgentPreferences;

const remote = (title: string, extra: Partial<PublicJob> = {}) =>
    mkJob(title, { title, experience_level: "senior", work_type: "remote", location: "Remote", location_country: null, tags: [], ...extra });

function location(resume: ResumeData, job: PublicJob, prefs: AgentPreferences | null = null) {
    const score = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs))!;
    return { score, reason: score.components.find((c) => c.key === "location")!.reason, detail: score.components.find((c) => c.key === "location")!.detail };
}

describe("a remote-only preference says how, not where", () => {
    const india = remote("Technical Account Manager (India)");

    it("an India-only TAM role is abroad for a remote-only résumé in Canada, and is no Today pick", () => {
        const { score, reason, detail } = location(TAM_TORONTO, india, REMOTE_ONLY);
        assert.equal(reason, "remote_abroad");
        assert.match(detail, /India/);
        assert.equal(todayLeftOut(score), "abroad");
    });

    it("the same role without the preference is abroad too", () => {
        assert.equal(location(TAM_TORONTO, india).reason, "remote_abroad");
    });

    it("a remote role that names nowhere is unknown, not a match for the preference", () => {
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager"), REMOTE_ONLY).reason, "remote_unplaced");
    });

    it("a remote role open anywhere, or in the candidate's own country, still meets the preference", () => {
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { location: "Remote - Anywhere" }), REMOTE_ONLY).reason, "remote_preferred");
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { place_restriction: OPEN_ANYWHERE }), REMOTE_ONLY).reason, "remote_preferred");
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { location: "Remote, Canada" }), REMOTE_ONLY).reason, "remote_preferred");
    });

    it("works the same for other countries and kinds of work", () => {
        assert.equal(location(SWE_LONDON, remote("Software Engineer (Remote, US only)"), REMOTE_ONLY).reason, "remote_abroad");
        assert.equal(location(SWE_BENGALURU, remote("Software Engineer (India)"), REMOTE_ONLY).reason, "remote_preferred");
        assert.equal(location(RN_TORONTO, remote("Registered Nurse - Telehealth", { location: "Remote (US only)" })).reason, "remote_abroad");
        assert.equal(location(RN_TORONTO, remote("Registered Nurse - Telehealth", { location: "Remote within Canada" })).reason, "remote_same_country");
    });
});

describe("reading a place from a title or a place field", () => {
    it("reads the place however the posting writes it", () => {
        assert.deepEqual(titlePlace("Technical Account Manager (India)")?.countries, ["India"]);
        assert.deepEqual(titlePlace("Account Executive (Remote, US only)")?.countries, ["United States"]);
        assert.deepEqual(titlePlace("Engineer – Remote US Only")?.countries, ["United States"]);
        assert.deepEqual(titlePlace("Designer - India-based")?.countries, ["India"]);
        assert.deepEqual(titlePlace("CSM (Remote - Germany)")?.countries, ["Germany"]);
        assert.deepEqual(titlePlace("Support Engineer - Anywhere in the UK")?.countries, ["United Kingdom"]);
        assert.equal(titlePlace("Customer Success Manager - EMEA")?.label, "EMEA");
        assert.deepEqual(jobCountries(mkJob("a", { location: "Remote (US only)" })), ["United States"]);
        assert.deepEqual(jobCountries(mkJob("b", { location: "US-based" })), ["United States"]);
        assert.deepEqual(jobCountries(mkJob("c", { location: "Remote India" })), ["India"]);
        assert.deepEqual(jobCountries(mkJob("d", { location: "Anywhere in the US" })), ["United States"]);
        assert.ok(jobCountries(mkJob("e", { location: "Remote (EMEA)" })).includes("France"));
    });

    it("never reads a skill, a team, a time zone or plain remote as a place", () => {
        for (const title of [
            "Technical Account Manager (Pre-Sales)",
            "Account Manager - Mid Market",
            "TAM - Public Sector",
            "Account Manager (Japanese speaking)",
            "Customer Success Manager, Remote",
            "Sales Engineer - US Time Zones",
            "Staff Engineer (Contract)",
        ]) {
            assert.equal(titlePlace(title), null, title);
        }
        assert.deepEqual(jobCountries(mkJob("f", { location: "Remote" })), []);
        assert.deepEqual(jobCountries(mkJob("g", { location: "Remote - Worldwide" })), []);
        assert.equal(placeNamed("Remote, US time zones"), null);
    });
});

describe("reading where a description says the person must be", () => {
    const places = (text: string | null, resolvePlace?: (p: string) => string | null) => readPlaceRestriction(text, resolvePlace)?.countries ?? null;

    it("reads requirements however they are written", () => {
        assert.deepEqual(places("<p>Candidates must be based in India.</p>"), ["India"]);
        assert.deepEqual(places("You must be authorized to work in the United States for any employer."), ["United States"]);
        assert.deepEqual(places("This role is open to candidates located in the US or Canada."), ["United States", "Canada"]);
        assert.deepEqual(places("This is a remote role based in Brazil, reporting to our CTO."), ["Brazil"]);
        assert.deepEqual(places("We are hiring remote within the UK."), ["United Kingdom"]);
        assert.deepEqual(places("Location: Remote (Philippines)\nAbout us…"), ["Philippines"]);
        assert.deepEqual(places("You will need to reside in Ontario."), ["Canada"]);
        assert.ok(places("Applicants must be located within EMEA.")!.includes("Germany"));
        assert.ok(places("You must be eligible to work in the EU without sponsorship.")!.includes("France"));
        assert.deepEqual(
            places("Must be based in Bengaluru and travel to client sites.", (p) => (p === "Bengaluru" ? "India" : null)),
            ["India"],
        );
    });

    it("never reads offices, customers, lifted limits or anywhere as a requirement", () => {
        assert.equal(places("We have offices in London, New York and Bangalore."), null);
        assert.equal(places("Our customers in Germany and Japan rely on us."), null);
        assert.equal(places("Regardless of where you live in the world, you must be based in a country where we have an entity."), null);
        assert.equal(places("There is no need to be based in the UK."), null);
        assert.equal(places("You will not need to reside in Canada."), null);
        assert.equal(places("Location: Remote"), null);
        assert.equal(places(null), null);
        // Open to people anywhere: no countries, so nothing weaker (the pay's currency) limits it either.
        assert.deepEqual(readPlaceRestriction("You don't need to be based in the US; we hire everywhere."), OPEN_ANYWHERE);
        assert.deepEqual(readPlaceRestriction("You can be based anywhere in the world."), OPEN_ANYWHERE);
    });

    it("a remote role whose description limits it to India is abroad for Canada and own-country for India", () => {
        const job = remote("Technical Account Manager", { place_restriction: readPlaceRestriction("Candidates must be based in India.") });
        assert.equal(location(TAM_TORONTO, job, REMOTE_ONLY).reason, "remote_abroad");
        assert.equal(location(SWE_BENGALURU, { ...job, title: "Software Engineer" }, REMOTE_ONLY).reason, "remote_preferred");
    });
});

describe("Today reads the descriptions of picks whose rows name no country", () => {
    const signals = resolveCandidateSignals(TAM_TORONTO, REMOTE_ONLY);
    const role = (job: PublicJob): TodayRole => ({ job, score: scoreJobAgainstResume(TAM_TORONTO, job, signals)! });
    const roles = [
        role(remote("Technical Account Manager", { id: "plain" })),
        role(remote("Technical Account Manager", { id: "india-desc", company: "Island" })),
        role(remote("Technical Account Manager (India)", { id: "india-title", company: "Island" })),
        role(remote("Technical Account Manager", { id: "canada", company: "Spellbook", location: "Remote, Canada" })),
    ];

    it("asks only about likely picks with no place of their own", () => {
        assert.deepEqual(new Set(placeCheckIds(roles, 24)), new Set(["plain", "india-desc"]));
    });

    it("a pick whose description is for people in India leaves; one that opens it to anyone stays", () => {
        const noted = withPlaceNotes(roles, { plain: OPEN_ANYWHERE, "india-desc": { label: "India", countries: ["India"] } }, (job) =>
            scoreJobAgainstResume(TAM_TORONTO, job, signals),
        );
        const picked = pickToday(noted, { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id);
        assert.ok(picked.includes("plain"));
        assert.ok(picked.includes("canada"));
        assert.ok(!picked.includes("india-desc"));
        assert.ok(!picked.includes("india-title"));
    });

    it("a pick whose description says nowhere stays out: no evidence they can take it", () => {
        const noted = withPlaceNotes(roles, { plain: null, "india-desc": null }, (job) => scoreJobAgainstResume(TAM_TORONTO, job, signals));
        const picked = pickToday(noted, { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id);
        assert.deepEqual(picked, ["canada"]);
        assert.equal(todayLeftOut(noted.find((r) => r.job.id === "plain")!.score), "unplaced");
    });
});

describe("a ranked list reads its roles' descriptions a stretch at a time", () => {
    const rows = Array.from({ length: 40 }, (_, i) => remote("Technical Account Manager", { id: `r${i}` }));
    rows[1] = remote("Technical Account Manager", { id: "r1", location: "Remote, Canada" });
    rows[2] = remote("Technical Account Manager (India)", { id: "r2" });

    it("reads the rows from the one in view on, skipping rows that name a place, at most a request's worth", () => {
        const ids = nextPlaceCheckIds(rows, 0, () => false);
        assert.equal(ids.length, 24);
        assert.deepEqual(ids.slice(0, 3), ["r0", "r3", "r4"]);
    });

    it("asks nothing while the next rows are read, and the next stretch once they aren't", () => {
        const read = new Set(nextPlaceCheckIds(rows, 0, () => false));
        assert.deepEqual(nextPlaceCheckIds(rows, 5, (id) => read.has(id)), []);
        const next = nextPlaceCheckIds(rows, 20, (id) => read.has(id));
        assert.deepEqual(next, ["r26", "r27", "r28", "r29", "r30", "r31", "r32", "r33", "r34", "r35", "r36", "r37", "r38", "r39"]);
    });

    it("a role already read, with or without a limit, is not read again", () => {
        assert.equal(needsPlaceCheck(remote("Technical Account Manager", { place_restriction: null })), false);
        assert.equal(needsPlaceCheck(remote("Technical Account Manager")), true);
    });
});

describe("a role's own page reads its description for place", () => {
    const withDescription = (description: string | null) => remote("Technical Account Manager", { description } as Partial<PublicJob>);

    it("reads countries, regions and cities the gazetteer knows", () => {
        assert.deepEqual(withDescriptionPlace(withDescription("<p>Candidates must be based in India.</p>")).place_restriction?.countries, ["India"]);
        assert.deepEqual(withDescriptionPlace(withDescription("You must be based in Bengaluru.")).place_restriction?.countries, ["India"]);
        assert.deepEqual(withDescriptionPlace(withDescription("We hire anywhere in the world.")).place_restriction, OPEN_ANYWHERE);
        assert.equal(withDescriptionPlace(withDescription("We build tools for finance teams.")).place_restriction, null);
    });

    it("the role reads as abroad on its page for Canada, as it does in the lists", () => {
        const job = withDescriptionPlace(withDescription("This role is open to candidates located in India."));
        assert.equal(location(TAM_TORONTO, job, REMOTE_ONLY).reason, "remote_abroad");
    });

    it("leaves a role without its description, or one already read, as it is", () => {
        const row = remote("Technical Account Manager");
        assert.equal(withDescriptionPlace(row), row);
        const read = withDescription("Candidates must be based in India.");
        const noted = { ...read, place_restriction: null };
        assert.equal(withDescriptionPlace(noted), noted);
    });
});

describe("every search page arrives with its rows' description places", () => {
    const page = [
        remote("Technical Account Manager", { id: "plain" }),
        remote("Technical Account Manager", { id: "india-desc" }),
        remote("Technical Account Manager (India)", { id: "india-title" }),
        remote("Technical Account Manager", { id: "canada", location: "Remote, Canada" }),
    ];
    const india = { label: "India", countries: ["India"] };

    it("reads only the rows that name no place, once, and marks each one read", async () => {
        const asked: string[][] = [];
        const rows = await withPlaceRestrictions(page, {
            read: async (ids) => {
                asked.push(ids);
                return { "india-desc": india, plain: null };
            },
        });
        assert.deepEqual(asked, [["plain", "india-desc"]]);
        assert.deepEqual(
            rows.map((r) => r.place_restriction),
            [null, india, undefined, undefined],
        );
        assert.equal(location(TAM_TORONTO, rows[1]!, REMOTE_ONLY).reason, "remote_abroad");
        assert.equal(needsPlaceCheck(rows[0]!), false);
    });

    it("a slow or failed read answers with the rows as they were, for the browser to read", async () => {
        let finished!: Promise<Record<string, never>>;
        const slow = await withPlaceRestrictions(page, {
            read: () => (finished = new Promise((resolve) => setTimeout(() => resolve({}), 60))),
            deadlineMs: 20,
        });
        assert.equal(slow, page);
        await finished;
        const failed = await withPlaceRestrictions(page, { read: () => Promise.reject(new Error("meili down")) });
        assert.equal(failed, page);
    });

    it("a late read keeps running to fill the cache, but only a few at once; past that it is stopped", async () => {
        const signals: AbortSignal[] = [];
        const finish: (() => void)[] = [];
        const read = (_ids: string[], signal: AbortSignal) =>
            new Promise<Record<string, never>>((resolve) => {
                signals.push(signal);
                finish.push(() => resolve({}));
            });
        for (let i = 0; i <= MAX_LATE_PLACE_READS; i++) assert.equal(await withPlaceRestrictions(page, { read, deadlineMs: 5 }), page);
        assert.deepEqual(
            signals.map((s) => s.aborted),
            [...Array(MAX_LATE_PLACE_READS).fill(false), true],
        );
        // Once the late reads finish, a slot is free again.
        for (const done of finish) done();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await withPlaceRestrictions(page, { read, deadlineMs: 5 });
        assert.equal(signals.at(-1)!.aborted, false);
        finish.at(-1)!();
    });

    it("reads at most a deep page's worth, and nothing when every row names a place", async () => {
        const deep = Array.from({ length: 200 }, (_, i) => remote("Technical Account Manager", { id: `d${i}` }));
        let count = 0;
        await withPlaceRestrictions(deep, { read: async (ids) => ((count = ids.length), {}) });
        assert.equal(count, SEARCH_PLACE_READ_MAX_IDS);
        let called = false;
        await withPlaceRestrictions([page[2]!, page[3]!], { read: async () => ((called = true), {}) });
        assert.equal(called, false);
    });
});

/**
 * 2026-10-03, a résumé in Canada: "Technical Account Manager - U.S. Federal"
 * (Island, Remote) and "Technical Account Manager" (Expel, Remote, USD
 * 114k–166k/yr) were Good Today picks. The title's "U.S. Federal" wasn't read
 * as a place, a description's "the U.S." ended at "U", and a role that names
 * no place but pays in another country's money read as open to anyone.
 */
describe("roles for people in the US, written the ways US postings write it", () => {
    const AUSTIN = at(resumeDataFromPlainText(fixture("vivek-tam-resume")), "Austin, Texas, United States");
    const usd = { salary_min: 114_000, salary_max: 166_000, salary_currency: "USD", salary_period: "year" } as const;

    it("reads a place before territory words in a title, never the territory words alone", () => {
        assert.deepEqual(titlePlace("Technical Account Manager - U.S. Federal")?.countries, ["United States"]);
        assert.deepEqual(titlePlace("Solutions Engineer, US Public Sector")?.countries, ["United States"]);
        assert.deepEqual(titlePlace("Account Executive - UK Public Sector")?.countries, ["United Kingdom"]);
        assert.deepEqual(titlePlace("Account Executive - DACH Mid-Market")?.countries, ["Germany", "Austria", "Switzerland"]);
        assert.deepEqual(titlePlace("Account Executive, Canada Federal")?.countries, ["Canada"]);
        assert.equal(titlePlace("Sales Engineer - Public Sector"), null);
        assert.equal(titlePlace("Technical Account Manager - Federal"), null);
        assert.equal(titlePlace("Account Executive - Japanese Speaking"), null);
    });

    it("the Island role is abroad for a résumé in Canada and no Today pick; it stays a fit in the US", () => {
        const island = remote("Technical Account Manager - U.S. Federal");
        const { score, reason, detail } = location(TAM_TORONTO, island);
        assert.equal(reason, "remote_abroad");
        assert.match(detail, /United States/);
        assert.equal(todayLeftOut(score), "abroad");
        assert.equal(location(AUSTIN, island).reason, "remote_same_country");
    });

    it("reads a dotted country as the country, at a sentence's end too", () => {
        const places = (text: string) => readPlaceRestriction(text)?.countries ?? null;
        assert.deepEqual(places("You must be authorized to work in the U.S."), ["United States"]);
        assert.deepEqual(places("You must be authorized to work in the U.S. We offer great benefits."), ["United States"]);
        assert.deepEqual(places("Candidates must reside in the U.S. or Canada."), ["United States", "Canada"]);
        assert.deepEqual(places("This role is remote within the U.K."), ["United Kingdom"]);
        assert.deepEqual(places("Applicants not authorized to work in the U.S. will not be considered."), ["United States"]);
        assert.equal(places("We are proud of our U.S. heritage. We have offices in the U.K. and India."), null);
    });

    it("reads citizenship and clearance requirements for any country, never a lifted one", () => {
        const places = (text: string) => readPlaceRestriction(text)?.countries ?? null;
        assert.deepEqual(places("Must be a U.S. citizen."), ["United States"]);
        assert.deepEqual(places("U.S. Citizenship is required for this role."), ["United States"]);
        assert.deepEqual(places("Visa sponsorship is not available; candidates must be US citizens or green card holders."), ["United States"]);
        assert.deepEqual(places("Must be a Canadian citizen or permanent resident."), ["Canada"]);
        assert.deepEqual(places("Open only to UK nationals."), ["United Kingdom"]);
        assert.deepEqual(places("Must be a citizen of India."), ["India"]);
        assert.deepEqual(places("This role requires an active TS/SCI clearance."), ["United States"]);
        assert.deepEqual(places("You must be eligible for SC clearance."), ["United Kingdom"]);
        assert.deepEqual(places("Requires NV1 clearance."), ["Australia"]);
        assert.deepEqual(places("Must hold Enhanced Reliability Status."), ["Canada"]);
        assert.deepEqual(places("Applicants who are not U.S. citizens will not be considered."), ["United States"]);
        assert.deepEqual(places("Non-U.S. citizens are not eligible for this role."), ["United States"]);
        assert.equal(places("Applicants who are not U.S. citizens are welcome to apply."), null);
        assert.equal(places("You do not need to be a US citizen."), null);
        assert.equal(places("US citizenship is not required."), null);
        assert.equal(places("Must be a Latin American citizen."), null);
        assert.equal(places("We need a people person: must be a people person."), null);
    });

    it("reads a description that opens the role to people anywhere, but not 'anywhere in the US'", () => {
        assert.deepEqual(readPlaceRestriction("Work from anywhere in the world."), OPEN_ANYWHERE);
        assert.deepEqual(readPlaceRestriction("This role is open to candidates located anywhere."), OPEN_ANYWHERE);
        assert.deepEqual(readPlaceRestriction("Location: Remote (Anywhere in the US)")?.countries, ["United States"]);
        assert.notDeepEqual(readPlaceRestriction("Work from anywhere (in the US)"), OPEN_ANYWHERE);
        // A stated limit outweighs a line about hiring globally.
        assert.deepEqual(readPlaceRestriction("We hire globally. This role must be based in Canada.")?.countries, ["Canada"]);
    });

    it("the Expel role, remote with no place and paid in USD, is likely for people in the US: no Today pick for Canada, and the label says why", () => {
        const expel = remote("Technical Account Manager", usd);
        for (const prefs of [null, REMOTE_ONLY]) {
            const { score, reason, detail } = location(TAM_TORONTO, expel, prefs);
            assert.equal(reason, "remote_pay_abroad");
            assert.match(detail, /USD.*the United States/);
            assert.equal(todayLeftOut(score), "abroad");
            assert.ok(score.total < 80, "never Strong");
            assert.match(explainMatch(score), /pays in USD, so it's likely for people in the United States/);
        }
        assert.equal(location(AUSTIN, expel).reason, "remote_pay_home");
    });

    it("the pay counts for any country and currency, only when nothing else names a place", () => {
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { ...usd, salary_currency: "CAD" })).reason, "remote_pay_home");
        assert.equal(location(SWE_LONDON, remote("Software Engineer", { ...usd, salary_currency: "GBP" })).reason, "remote_pay_home");
        assert.match(location(SWE_LONDON, remote("Software Engineer", { ...usd, salary_currency: "EUR" })).detail, /the euro area/);
        assert.match(location(SWE_BENGALURU, remote("Software Engineer", { ...usd, salary_currency: "USD" })).detail, /the United States/);
        assert.equal(location(SWE_BENGALURU, remote("Software Engineer", { ...usd, salary_currency: "INR" })).reason, "remote_pay_home");
        // The place, the title or the description outrank the pay.
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { ...usd, location: "Remote, Canada" })).reason, "remote_same_country");
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { ...usd, place_restriction: OPEN_ANYWHERE })).reason, "remote_anywhere");
        assert.equal(
            location(TAM_TORONTO, remote("Technical Account Manager", { ...usd, place_restriction: { label: "United States or Canada", countries: ["United States", "Canada"] } })).reason,
            "remote_same_country",
        );
        // A currency with no amount or an unknown currency says nothing: the role stays unknown, never assumed open.
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { salary_currency: "USD" })).reason, "remote_unplaced");
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager", { ...usd, salary_currency: "XYZ" })).reason, "remote_unplaced");
        const moving = { configured: true, search: {}, answers: { relocation: "Yes, to the United States" } } as unknown as AgentPreferences;
        assert.notEqual(location(TAM_TORONTO, remote("Technical Account Manager", usd), moving).reason, "remote_pay_abroad");
    });

    it("Today still reads the description of a role left out only for its pay, so 'anywhere' can bring it back", () => {
        const signals = resolveCandidateSignals(TAM_TORONTO, null);
        const role = (job: PublicJob): TodayRole => ({ job, score: scoreJobAgainstResume(TAM_TORONTO, job, signals)! });
        const roles = [role({ ...remote("Technical Account Manager", usd), id: "pays-usd" })];
        assert.deepEqual(pickToday(roles, { skipped: new Set(), tracked: new Set() }), []);
        assert.deepEqual(placeCheckIds(roles, 24), ["pays-usd"]);
        const noted = withPlaceNotes(roles, { "pays-usd": OPEN_ANYWHERE }, (job) => scoreJobAgainstResume(TAM_TORONTO, job, signals));
        assert.deepEqual(pickToday(noted, { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id), ["pays-usd"]);
    });
});

/**
 * One rule for every country and kind of role: Today picks a role only on evidence the candidate can
 * take it from where they are. "Remote" alone, a country tag wider than the role, or a candidate whose
 * country can't be read used to pass as open, so US-only roles were Good picks in Canada (2026-10-05).
 */
describe("a pick needs evidence the candidate can take it", () => {
    const today = (resume: ResumeData, jobs: PublicJob[], prefs: AgentPreferences | null = null) => {
        const signals = resolveCandidateSignals(resume, prefs);
        const roles = jobs.map((job) => ({ job, score: scoreJobAgainstResume(resume, job, signals)! }));
        return pickToday(roles, { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id);
    };
    const usAndCanada = { location_country: ["United States", "Canada"] };

    it("a description narrows a wider country tag, for any country", () => {
        const usOnly = { label: "United States", countries: ["United States"] };
        const tagged = remote("Technical Account Manager", { ...usAndCanada, place_restriction: usOnly });
        assert.equal(location(TAM_TORONTO, tagged).reason, "remote_abroad");
        const austin = at(TAM_TORONTO, "Austin, Texas, United States");
        assert.equal(location(austin, tagged).reason, "remote_same_country");
        const emea = remote("Software Engineer", {
            location_country: ["United Kingdom", "Germany", "India"],
            place_restriction: { label: "India", countries: ["India"] },
        });
        assert.equal(location(SWE_LONDON, emea).reason, "remote_abroad");
        assert.equal(location(SWE_BENGALURU, emea).reason, "remote_same_country");
        // A requirement that shares no country with the tags leaves the tags as they are.
        const disjoint = remote("Technical Account Manager", { location_country: "Canada", place_restriction: usOnly });
        assert.equal(location(TAM_TORONTO, disjoint).reason, "remote_same_country");
    });

    it("rows tagged for several countries, with no place in the title, are read; a single tag or a placed title is not", () => {
        assert.equal(needsPlaceCheck(remote("Technical Account Manager", usAndCanada)), true);
        assert.equal(needsPlaceCheck(remote("Technical Account Manager", { location: "Remote - North America" })), true);
        assert.equal(needsPlaceCheck(remote("Technical Account Manager - U.S. Federal", usAndCanada)), false);
        assert.equal(needsPlaceCheck(remote("Technical Account Manager", { location_country: "Canada" })), false);
        assert.equal(needsPlaceCheck(remote("Technical Account Manager", { ...usAndCanada, place_restriction: null })), false);
    });

    it("Today reads the descriptions of picks tagged for several countries and of roles that name nowhere", () => {
        const signals = resolveCandidateSignals(TAM_TORONTO, null);
        const role = (job: PublicJob): TodayRole => ({ job, score: scoreJobAgainstResume(TAM_TORONTO, job, signals)! });
        const roles = [
            role(remote("Technical Account Manager", { id: "wide", company: "Island", ...usAndCanada })),
            role(remote("Technical Account Manager", { id: "nowhere", company: "Expel" })),
            role(remote("Technical Account Manager", { id: "canada", company: "Spellbook", location: "Remote, Canada" })),
        ];
        assert.deepEqual(new Set(placeCheckIds(roles, 24)), new Set(["wide", "nowhere"]));
    });

    it("roles that name nowhere are never picks, for any country or kind of work; their own country's roles are", () => {
        const homes: Array<[ResumeData, string]> = [
            [TAM_TORONTO, "Remote, Canada"],
            [RN_TORONTO, "Remote within Canada"],
            [SWE_LONDON, "Remote, United Kingdom"],
            [SWE_BENGALURU, "Remote, India"],
        ];
        for (const [resume, home] of homes) {
            const title = resume === RN_TORONTO ? "Registered Nurse - Telehealth" : resume === TAM_TORONTO ? "Technical Account Manager" : "Software Engineer";
            const picked = today(resume, [
                remote(title, { id: "nowhere", company: "A" }),
                remote(title, { id: "home", company: "B", location: home }),
                remote(title, { id: "anywhere", company: "C", location: "Remote - Anywhere" }),
            ]);
            assert.deepEqual(picked.sort(), ["anywhere", "home"], home);
        }
    });

    it("a candidate whose country can't be read gets only roles open to anyone", () => {
        const nowhere = at(TAM_TORONTO, "");
        const picked = today(nowhere, [
            remote("Technical Account Manager", { id: "nowhere", company: "A" }),
            remote("Technical Account Manager", { id: "canada", company: "B", location: "Remote, Canada" }),
            remote("Technical Account Manager - U.S. Federal", { id: "us", company: "C" }),
            remote("Technical Account Manager", { id: "anywhere", company: "D", place_restriction: OPEN_ANYWHERE }),
        ]);
        assert.deepEqual(picked, ["anywhere"]);
    });
});
