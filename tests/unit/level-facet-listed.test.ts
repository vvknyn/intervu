import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { experienceLevelFacet } from "../../src/lib/jobs/resume-match";
import { seniorityOfLevel } from "../../src/lib/jobs/candidate-signals";
import { jobLevel } from "../../src/lib/match/score";

describe("a candidate's level search retrieves every listing level scoring reads as that level", () => {
    // 2026-10-17: roles listed Lead read senior and fitted a senior candidate, but the search asked for mid and senior only,
    // so they were never retrieved (an outside count put ten Canada remote PM roles there).
    it("a senior candidate retrieves roles listed Lead, not Executive", () => {
        const levels = experienceLevelFacet("senior")!;
        assert.deepEqual(levels, ["mid", "senior", "lead"]);
        assert.ok(!levels.includes("executive"), "past Senior: the pool leaves it out unless the résumé holds such a role");
    });

    it("a listed Lead role is scored as senior, so the level it is retrieved under is its own", () => {
        assert.equal(seniorityOfLevel("lead"), "senior");
        assert.equal(jobLevel({ experience_level: "lead", title: "Product Manager", min_years_experience: null }), "senior");
    });

    it("every listing level retrieved reads as a level the candidate's search holds", () => {
        for (const step of ["entry", "mid", "senior"] as const) {
            const levels = experienceLevelFacet(step)!;
            const steps = new Set(levels.filter((l) => l === "entry" || l === "mid" || l === "senior"));
            for (const level of levels) assert.ok(steps.has(seniorityOfLevel(level)!), `${step}: ${level}`);
        }
    });

    it("no level known adds no level filter", () => {
        assert.equal(experienceLevelFacet(null), null);
    });
});
