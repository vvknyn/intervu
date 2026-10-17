import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { titleLevel } from "../../src/lib/jobs/role-level";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { deckLeftOut } from "../../src/lib/jobs/for-you/band-order";
import { farBelowLevel, jobLevel, scoreJobAgainstResume } from "../../src/lib/match/score";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

// 2026-10-17, his Search screenshot: Rezdy's "Associate Product Manager" read Strong for a 13-year senior PM.
describe("an opening Associate ranks a title as entry level", () => {
    it("reads the entry rung of a line of work as entry, whatever the listing says", () => {
        for (const title of ["Associate Product Manager", "Associate Software Engineer", "Associate Consultant", "Associate Brand Manager"]) {
            assert.deepEqual(titleLevel(title), { level: "entry", explicit: true }, title);
        }
        assert.equal(jobLevel({ title: "Associate Product Manager", experience_level: "mid", min_years_experience: null }), "entry");
    });

    it("leaves a rank above it, and the titles where Associate is a rank of its own, as they read", () => {
        assert.equal(titleLevel("Associate Director, Product")?.level, "senior");
        assert.equal(titleLevel("Associate Vice President")?.level, "senior");
        assert.equal(titleLevel("Senior Associate Product Manager")?.level, "senior");
        for (const title of ["Associate Partner", "Associate Professor of Nursing", "Associate Attorney", "Associate Manager, Product", "Associate, Investment Banking", "Sales Associate", "Research Associate"]) {
            assert.equal(titleLevel(title), null, title);
        }
    });

    it("leaves an Associate Product Manager role out of a senior PM's lists, listed mid or not", () => {
        const resume = structureResumeText(readFileSync("tests/fixtures/vivek-pm-resume.txt", "utf8").replace(/'/g, "’")) as ResumeData;
        const signals = resolveCandidateSignals(resume, { configured: true, search: { remoteOnly: true }, answers: {} } as never);
        for (const level of ["mid", null]) {
            const job = {
                id: "rezdy", title: "Associate Product Manager", company: "Rezdy", location: "Vancouver, BC, Canada", location_country: "Canada",
                work_type: "remote", experience_level: level, posted_ts: Date.now() - 9 * 86_400_000, tags: [],
            } as unknown as PublicJob;
            const score = scoreJobAgainstResume(resume, job, signals)!;
            assert.equal(farBelowLevel(score), true, String(level));
            assert.equal(deckLeftOut(job, score, Date.now()), "level");
        }
    });
});
