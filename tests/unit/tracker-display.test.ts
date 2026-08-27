import assert from "node:assert/strict";
import { test } from "node:test";
import {
    countByTrackerFilter,
    groupPursuitsByBoardColumn,
    isActiveTrackerLaneStage,
    matchesTrackerFilter,
    matchesTrackerSearch,
    trackerStatusLabel,
    visibleTrackerBoardColumns,
} from "../../src/lib/pursuits/tracker-display";
import type { Pursuit } from "../../src/lib/pursuits/types";

function pursuit(overrides: Partial<Pursuit> = {}): Pursuit {
    const now = new Date().toISOString();
    return {
        id: "p1",
        user_id: "u1",
        company_name: "Acme",
        position: "Engineer",
        status: "applied",
        created_at: now,
        updated_at: now,
        ...overrides,
    };
}

test("matchesTrackerFilter maps saved bucket to interested and resume_ready", () => {
    assert.equal(matchesTrackerFilter(pursuit({ status: "interested" }), "saved"), true);
    assert.equal(matchesTrackerFilter(pursuit({ status: "resume_ready" }), "saved"), true);
    assert.equal(matchesTrackerFilter(pursuit({ status: "applied" }), "saved"), false);
});

test("matchesTrackerSearch matches company or role case-insensitively", () => {
    const p = pursuit({ company_name: "Northwind", position: "Staff Engineer" });
    assert.equal(matchesTrackerSearch(p, "north"), true);
    assert.equal(matchesTrackerSearch(p, "staff"), true);
    assert.equal(matchesTrackerSearch(p, "product"), false);
});

test("countByTrackerFilter and trackerStatusLabel stay aligned", () => {
    const list = [
        pursuit({ status: "interested" }),
        pursuit({ id: "p2", status: "applied" }),
        pursuit({ id: "p3", status: "interviewing" }),
        pursuit({ id: "p4", status: "offer" }),
    ];
    const counts = countByTrackerFilter(list);
    assert.equal(counts.saved, 1);
    assert.equal(counts.applied, 1);
    assert.equal(trackerStatusLabel("resume_ready"), "Saved");
});

test("visibleTrackerBoardColumns shows all columns for all filter, one column otherwise", () => {
    assert.deepEqual(visibleTrackerBoardColumns("all"), [
        "saved",
        "applied",
        "interviewing",
        "offer",
        "closed",
    ]);
    assert.deepEqual(visibleTrackerBoardColumns("applied"), ["applied"]);
});

test("isActiveTrackerLaneStage collapses stages into the same lane as the board does", () => {
    // resume_ready has no button of its own in TRACKER_LANE_STAGES — it must
    // still light up "Saved" (stage: "interested"), same as boardColumn.
    assert.equal(isActiveTrackerLaneStage("resume_ready", "interested"), true);
    // rejected has no button of its own either — it must light up "Closed"
    // (stage: "withdrawn"), not stay unmatched.
    assert.equal(isActiveTrackerLaneStage("rejected", "withdrawn"), true);
    // A pursuit sitting in one lane must not also read as active in another.
    assert.equal(isActiveTrackerLaneStage("applied", "interviewing"), false);
    assert.equal(isActiveTrackerLaneStage("interested", "withdrawn"), false);
});

test("groupPursuitsByBoardColumn buckets by boardColumn exhaustively", () => {
    const list = [
        pursuit({ id: "p1", status: "interested" }),
        pursuit({ id: "p2", status: "resume_ready" }),
        pursuit({ id: "p3", status: "applied" }),
        pursuit({ id: "p4", status: "interviewing" }),
        pursuit({ id: "p5", status: "offer" }),
        pursuit({ id: "p6", status: "rejected" }),
        pursuit({ id: "p7", status: "withdrawn" }),
    ];
    const groups = groupPursuitsByBoardColumn(list);
    assert.equal(groups.saved.length, 2);
    assert.equal(groups.applied.length, 1);
    assert.equal(groups.interviewing.length, 1);
    assert.equal(groups.offer.length, 1);
    assert.equal(groups.closed.length, 2);
});
