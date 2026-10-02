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
import { SEARCH_PLACE_READ_MAX_IDS, withDescriptionPlace, withPlaceRestrictions } from "@/lib/jobs/place-notes";
import { needsPlaceCheck, nextPlaceCheckIds, readPlaceRestriction } from "@/lib/jobs/place-restriction";
import { jobCountries, placeNamed, titlePlace } from "@/lib/jobs/resume-location";
import type { PublicJob } from "@/lib/jobs/types";
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

    it("a remote role open anywhere, or in the candidate's own country, still meets the preference", () => {
        assert.equal(location(TAM_TORONTO, remote("Technical Account Manager"), REMOTE_ONLY).reason, "remote_preferred");
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
        assert.equal(places("You don't need to be based in the US; we hire everywhere."), null);
        assert.equal(places("Regardless of where you live in the world, you must be based in a country where we have an entity."), null);
        assert.equal(places("You can be based anywhere in the world."), null);
        assert.equal(places("Location: Remote"), null);
        assert.equal(places(null), null);
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

    it("a pick whose description is for people in India leaves; one with no limit stays", () => {
        const noted = withPlaceNotes(roles, { plain: null, "india-desc": { label: "India", countries: ["India"] } }, (job) =>
            scoreJobAgainstResume(TAM_TORONTO, job, signals),
        );
        const picked = pickToday(noted, { skipped: new Set(), tracked: new Set() }).map((r) => r.job.id);
        assert.ok(picked.includes("plain"));
        assert.ok(picked.includes("canada"));
        assert.ok(!picked.includes("india-desc"));
        assert.ok(!picked.includes("india-title"));
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
        assert.equal(withDescriptionPlace(withDescription("We hire anywhere in the world.")).place_restriction, null);
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
        let stopped: AbortSignal | null = null;
        const slow = await withPlaceRestrictions(page, {
            read: (_ids, signal) => ((stopped = signal), new Promise((resolve) => setTimeout(() => resolve({}), 200))),
            deadlineMs: 20,
        });
        assert.equal(slow, page);
        // The late read is stopped, not left loading Meili.
        assert.equal((stopped as AbortSignal | null)?.aborted, true);
        const failed = await withPlaceRestrictions(page, { read: () => Promise.reject(new Error("meili down")) });
        assert.equal(failed, page);
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
