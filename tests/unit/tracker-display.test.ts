import assert from "node:assert/strict";
import { test } from "node:test";
import {
    countByTrackerFilter,
    matchesTrackerFilter,
    matchesTrackerSearch,
    trackerStatusLabel,
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
