import assert from "node:assert/strict";
import { test } from "node:test";
import { hubTrackerStats } from "../../src/lib/jobs/for-you/hub-your-jobs";
import { countByTrackerFilter, groupPursuitsByBoardColumn, parseTrackerStage, trackerStageHref } from "../../src/lib/pursuits/tracker-display";
import type { Pursuit, PursuitStage } from "../../src/lib/pursuits/types";

const pursuit = (id: string, status: PursuitStage): Pursuit => ({
    id,
    user_id: "u",
    company_name: "Acme",
    position: `Role ${id}`,
    status,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-25T00:00:00.000Z",
});

test("each packs-home tracker number opens /yours on the lane holding exactly the rows it counts", () => {
    const pursuits = [
        pursuit("a", "applied"),
        pursuit("b", "applied"),
        pursuit("c", "interviewing"),
        pursuit("d", "interested"),
        pursuit("e", "resume_ready"),
        pursuit("f", "offer"),
        pursuit("g", "rejected"),
    ];
    const lanes = groupPursuitsByBoardColumn(pursuits);
    for (const stat of hubTrackerStats(pursuits)) {
        const href = trackerStageHref(stat.key);
        const stage = parseTrackerStage(new URL(href, "https://velai.app").searchParams.get("stage"));
        assert.equal(stage, stat.key);
        assert.equal(lanes[stage!].length, stat.value, stat.key);
    }
    assert.equal(countByTrackerFilter(pursuits).saved, 2);
});

test("a ?stage= that names no lane shows every stage", () => {
    for (const value of [null, undefined, "", "all", "rejected", "APPLIED", "applied "]) {
        assert.equal(parseTrackerStage(value), null, String(value));
    }
    assert.equal(parseTrackerStage("closed"), "closed");
});
