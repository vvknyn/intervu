/**
 * "Hires in Canada": a remote role whose posting says it hires in the candidate's country, in words its place
 * fields don't carry, is labelled with the country and the posting's own line (CareerHound borrow list, 2026-10-21:
 * their pitch is "Canadians welcome" read off US postings; ours never says it without the line). For any country:
 * the cases use Canada first, then the same rule for the UK and India.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HiresInLine, HiresInWord, hiresNoteOf } from "@/components/jobs/HiresIn";
import { JobCard } from "@/components/jobs/JobCard";
import { resolveCandidateSignals } from "@/lib/jobs/candidate-signals";
import { readPlaceRestriction } from "@/lib/jobs/place-restriction";
import type { PlaceRestriction, PublicJob } from "@/lib/jobs/types";
import { explainMatch } from "@/lib/match/explain";
import { scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { resumeDataFromPlainText, structureResumeText } from "@/lib/resume/structure-resume-text";
import type { ResumeData } from "@/types/resume";
import { mkJob, NOW } from "../support/jobs-corpus-stub";

before(() => mock.timers.enable({ apis: ["Date"], now: NOW }));
after(() => mock.timers.reset());

const fixture = (name: string) => readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), "utf8");
const at = (resume: ResumeData, location: string): ResumeData => ({ ...resume, profile: { ...resume.profile, location } });
const TAM_TORONTO = at(resumeDataFromPlainText(fixture("vivek-tam-resume")), "Toronto, Ontario");
const TAM_AUSTIN = at(resumeDataFromPlainText(fixture("vivek-tam-resume")), "Austin, Texas");
const SWE_LONDON = at(structureResumeText(fixture("sample-resume").replace(/'/g, "’")) as ResumeData, "London, United Kingdom");
const SWE_BENGALURU = at(structureResumeText(fixture("sample-resume").replace(/'/g, "’")) as ResumeData, "Bengaluru, India");

const remote = (extra: Partial<PublicJob> = {}) =>
    mkJob("tam", { title: "Technical Account Manager", experience_level: "mid", work_type: "remote", location: "Remote", location_country: null, tags: [], ...extra });

const score = (resume: ResumeData, job: PublicJob) => scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, null))!;
const location = (resume: ResumeData, job: PublicJob) => score(resume, job).components.find((c) => c.key === "location")!;

describe("the reader hands back the posting's own line with the place", () => {
    it("quotes the sentence that limits the role", () => {
        const read = readPlaceRestriction("About us.\nThis role is open to candidates located in the US or Canada. Benefits include…");
        assert.deepEqual(read?.countries, ["United States", "Canada"]);
        assert.equal(read?.quote, "This role is open to candidates located in the US or Canada.");
    });

    it("reads a posting's heading line: 'Remote, Canada; Austin, TX', 'Remote - US or Canada', 'Remote in Canada'", () => {
        const heading = readPlaceRestriction("About the role\nRemote, Canada; Austin, TX\nWe are building…");
        assert.deepEqual(heading?.countries, ["Canada", "United States"]);
        assert.equal(heading?.quote, "Remote, Canada; Austin, TX");
        assert.deepEqual(readPlaceRestriction("Remote - US or Canada\nResponsibilities")?.countries, ["United States", "Canada"]);
        assert.deepEqual(readPlaceRestriction("- Remote in Canada.\nBenefits")?.countries, ["Canada"]);
        // A city is read through the caller's resolver (the server passes the gazetteer).
        const cities: Record<string, string> = { Toronto: "Canada", Vancouver: "Canada", Montréal: "Canada" };
        assert.deepEqual(readPlaceRestriction("Remote – Toronto, Vancouver, Montréal", (city) => cities[city] ?? null)?.countries, ["Canada"]);
    });

    it("reads 'work from anywhere in North America' as the region, not as anywhere", () => {
        const read = readPlaceRestriction("You can work from anywhere in North America.");
        assert.equal(read?.label, "North America");
        assert.ok(read?.countries.includes("Canada") && read.countries.includes("United States"));
    });

    it("reads a welcome as open: the place is one the role hires in, not the only one", () => {
        for (const text of ["Candidates in Canada and the US are welcome to apply.", "Canada-based candidates are encouraged to apply!", "Canadians are welcome."]) {
            const read = readPlaceRestriction(text);
            assert.ok(read?.countries.includes("Canada"), text);
            assert.equal(read?.open, true, text);
            assert.equal(read?.quote, text, text);
        }
        // A limit outweighs a welcome.
        const both = readPlaceRestriction("Canadians are welcome. Candidates must be based in the US.");
        assert.deepEqual(both?.countries, ["United States"]);
        assert.equal(both?.open, undefined);
    });

    it("reads no place from prose that only starts with 'Remote' or says 'welcome'", () => {
        for (const text of [
            "Remote-first company with offices in Toronto and NYC. You will own the roadmap.",
            "Remote, flexible hours and a home-office stipend.",
            "Remote work is encouraged.",
            "Remote: Yes",
            "Remote, with occasional travel to our Austin office",
            "Applicants from any background are welcome.",
            "Work from anywhere (in the US)",
            "We do not accept candidates in India.",
        ]) {
            assert.equal(readPlaceRestriction(text), null, text);
        }
    });

    it("decodes the entities a quote would otherwise show", () => {
        const read = readPlaceRestriction("<p>We&rsquo;re remote. Candidates must be based in Canada&nbsp;or the US.</p>");
        assert.equal(read?.quote, "Candidates must be based in Canada or the US.");
    });
});

describe("a remote role carries 'hires' when its posting, not its place fields, puts it in the candidate's country", () => {
    it("a place text that names Canada beside the United States tag: the line is the place text", () => {
        const job = remote({ location: "Remote, Canada; Austin, TX", location_country: "United States" });
        const toronto = location(TAM_TORONTO, job);
        assert.equal(toronto.reason, "remote_same_country");
        assert.deepEqual(toronto.hires, { country: "Canada", quote: "Remote, Canada; Austin, TX" });
        // A candidate in Austin is told nothing new: the tag already says the United States alone.
        assert.equal(location(TAM_AUSTIN, job).reason, "remote_same_country");
        assert.equal(location(TAM_AUSTIN, job).hires, undefined);
    });

    it("a description that limits the role to the US or Canada, on a row that names no country", () => {
        const place = readPlaceRestriction("This role is open to candidates located in the US or Canada.");
        const job = remote({ place_restriction: place });
        const toronto = location(TAM_TORONTO, job);
        assert.equal(toronto.reason, "remote_same_country");
        assert.deepEqual(toronto.hires, { country: "Canada", quote: "This role is open to candidates located in the US or Canada." });
        // For a candidate in India the same line makes it a role abroad, with no note.
        assert.equal(location(SWE_BENGALURU, job).reason, "remote_abroad");
        assert.equal(location(SWE_BENGALURU, job).hires, undefined);
    });

    it("a welcome adds the candidate's country and never takes another's away", () => {
        const welcome = readPlaceRestriction("Canadians are welcome to apply for this role.") as PlaceRestriction;
        assert.equal(welcome.open, true);
        const job = remote({ place_restriction: welcome });
        assert.equal(location(TAM_TORONTO, job).reason, "remote_same_country");
        assert.equal(location(TAM_TORONTO, job).hires?.country, "Canada");
        // Someone elsewhere is not told it is abroad: the role names nowhere for them.
        assert.equal(location(SWE_LONDON, job).reason, "remote_unplaced");
        assert.equal(location(SWE_LONDON, job).hires, undefined);
    });

    it("the same rule holds for another country: a posting that says the UK, for a candidate in London", () => {
        const place = readPlaceRestriction("Location: Remote, UK or Ireland\nAbout the team");
        const job = remote({ title: "Software Engineer", place_restriction: place });
        const london = location(SWE_LONDON, job);
        assert.equal(london.reason, "remote_same_country");
        assert.equal(london.hires?.country, "United Kingdom");
        assert.match(london.hires!.quote, /Remote, UK or Ireland/);
    });

    it("says nothing where the place fields already say the country alone, for an on-site role, or without a line", () => {
        assert.equal(location(TAM_TORONTO, remote({ location: "Remote, Canada", location_country: "Canada" })).hires, undefined);
        assert.equal(location(TAM_TORONTO, remote({ work_type: "hybrid", location: "Toronto, ON", location_country: "Canada" })).hires, undefined);
        // Tagged both countries, no place text: nothing to quote.
        assert.equal(location(TAM_TORONTO, remote({ location: "Remote", location_country: ["United States", "Canada"] as unknown as string })).hires, undefined);
        // A role for people in the US: no note, and it still reads as abroad.
        const us = remote({ place_restriction: readPlaceRestriction("Candidates must be based in the US.") });
        assert.equal(location(TAM_TORONTO, us).hires, undefined);
        assert.equal(location(TAM_TORONTO, us).reason, "remote_abroad");
    });

    it("the match explanation quotes the line", () => {
        const job = remote({ location: "Remote, Canada; Austin, TX", location_country: "United States" });
        assert.match(explainMatch(score(TAM_TORONTO, job)), /remote and the posting hires in Canada: “Remote, Canada; Austin, TX”/);
    });
});

describe("the row and the detail pane say it with the line", () => {
    const job = remote({ id: "row", location: "Remote, Canada; Austin, TX", location_country: "United States", company: "Acme", company_domain: "acme.example" });
    const matched: MatchScore = score(TAM_TORONTO, job);
    const card = (matchScore: MatchScore | null) =>
        renderToStaticMarkup(React.createElement(JobCard, { job, active: false, opened: false, onClick: () => {}, now: NOW, matchScore }));

    it("a row shows 'Hires in Canada' once, with the line for a tap, only when the score carries the note", () => {
        const html = card(matched);
        assert.equal((html.match(/data-testid="hires-in"/g) ?? []).length, 1);
        assert.match(html, /Hires in Canada/);
        assert.equal(card(null).includes("hires-in"), false);
        assert.equal(card(score(TAM_AUSTIN, job)).includes("hires-in"), false);
    });

    it("the note is read from the score by one function, and the detail line prints the posting's words", () => {
        const note = hiresNoteOf(matched)!;
        assert.deepEqual(note, { country: "Canada", quote: "Remote, Canada; Austin, TX" });
        assert.equal(hiresNoteOf(null), null);
        const html = renderToStaticMarkup(React.createElement(HiresInLine, { note }));
        assert.match(html, /Hires in Canada/);
        assert.match(html, /“Remote, Canada; Austin, TX”/);
        // A country whose name takes "the" reads the way the rest of the site says it.
        assert.match(renderToStaticMarkup(React.createElement(HiresInWord, { note: { country: "United States", quote: "Remote - US" } })), /Hires in the United States/);
    });
});
