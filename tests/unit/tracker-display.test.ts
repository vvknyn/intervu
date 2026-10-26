import assert from "node:assert/strict";
import { test } from "node:test";
import {
    countByTrackerFilter,
    countOpenPursuits,
    groupPursuitsByBoardColumn,
    isCurrentTrackerStatus,
    pursuitDateFacts,
    TRACKER_STATUS_OPTIONS,
    trackerStatusPatch,
    matchesTrackerFilter,
    matchesTrackerSearch,
    trackerStatusLabel,
    pursuitRowMetaItems,
    trackerResumeMetaLabel,
    visibleTrackerBoardColumns,
} from "../../src/lib/pursuits/tracker-display";
import { trackerPageHeading } from "../../src/lib/pursuits/tracker-voice-copy";
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

test("trackerResumeMetaLabel spells résumé with accent in row meta", () => {
    assert.equal(trackerResumeMetaLabel(false), "no résumé");
    assert.equal(trackerResumeMetaLabel(true), "résumé linked");
});

test("pursuitRowMetaItems omits zero-day tracker age and unlinked résumé line", () => {
    const now = Date.parse("2026-06-01T12:00:00.000Z");
    const iso = new Date(now).toISOString();
    assert.deepEqual(
        pursuitRowMetaItems(
            pursuit({ created_at: iso, updated_at: iso }),
            now,
        ),
        [],
    );
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

test("the status list offers Rejected and Withdrawn as their own buttons", () => {
    // A single "Closed" button wrote withdrawn, so a rejection could not be
    // recorded from the UI at all (2026-09-30).
    assert.deepEqual(
        TRACKER_STATUS_OPTIONS.map((o) => [o.stage, o.label]),
        [
            ["interested", "Saved"],
            ["applied", "Applied"],
            ["interviewing", "Interviewing"],
            ["offer", "Offer"],
            ["rejected", "Rejected"],
            ["withdrawn", "Withdrawn"],
        ],
    );
});

test("isCurrentTrackerStatus presses exactly one button for every stage", () => {
    for (const stage of ["interested", "resume_ready", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const) {
        const pressed = TRACKER_STATUS_OPTIONS.filter((o) => isCurrentTrackerStatus(stage, o.stage));
        assert.equal(pressed.length, 1, stage);
    }
    // resume_ready has no button of its own; it reads as Saved.
    assert.equal(isCurrentTrackerStatus("resume_ready", "interested"), true);
    assert.equal(isCurrentTrackerStatus("rejected", "rejected"), true);
    assert.equal(isCurrentTrackerStatus("rejected", "withdrawn"), false);
    assert.equal(isCurrentTrackerStatus("applied", "interviewing"), false);
});

test("trackerStatusPatch stamps applied_at once, moving up into Applied", () => {
    const now = "2026-09-30T04:00:00.000Z";
    assert.deepEqual(trackerStatusPatch({ status: "interested" }, "applied", now), { status: "applied", applied_at: now });
    assert.deepEqual(trackerStatusPatch({ status: "resume_ready" }, "applied", now), { status: "applied", applied_at: now });
    assert.deepEqual(
        trackerStatusPatch({ status: "rejected", applied_at: "2026-09-01T00:00:00.000Z" }, "applied", now),
        { status: "applied" },
    );
    // Stepping back from Interviewing is not a new application (same rule as #714's job-page writes).
    assert.deepEqual(trackerStatusPatch({ status: "interviewing" }, "applied", now), { status: "applied" });
    assert.deepEqual(trackerStatusPatch({ status: "applied" }, "rejected", now), { status: "rejected" });
});

test("pursuitDateFacts lists stored dates only, the interview day in UTC", () => {
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    const created = "2026-09-20T15:00:00.000Z";
    const day = (iso: string, timeZone?: string) =>
        new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
    assert.deepEqual(pursuitDateFacts(pursuit({ status: "interested", created_at: created, updated_at: created }), now), [
        `Saved ${day(created)}`,
    ]);
    const applied = "2026-09-28T15:00:00.000Z";
    const interview = "2026-10-03T00:00:00.000Z";
    assert.deepEqual(
        pursuitDateFacts(pursuit({ status: "interviewing", created_at: created, updated_at: created, applied_at: applied, interview_date: interview }), now),
        [`Applied ${day(applied)}`, `Interview ${day(interview, "UTC")}`],
    );
    // An outcome adds the last update, the closest stored date to when it closed.
    const updated = "2026-09-29T15:00:00.000Z";
    assert.deepEqual(pursuitDateFacts(pursuit({ status: "rejected", created_at: created, updated_at: updated, applied_at: applied }), now), [
        `Applied ${day(applied)}`,
        `Updated ${day(updated)}`,
    ]);
    // Moved back to Saved: an old applied date is not what the row says.
    assert.deepEqual(pursuitDateFacts(pursuit({ status: "interested", created_at: created, updated_at: updated, applied_at: applied }), now), [
        `Saved ${day(created)}`,
    ]);
    // Another year shows the year.
    const lastYear = "2025-11-02T15:00:00.000Z";
    assert.match(pursuitDateFacts(pursuit({ status: "interested", created_at: lastYear, updated_at: lastYear }), now)[0]!, /2025/);
});

test("countOpenPursuits leaves rejected and withdrawn roles out of the Tracker count", () => {
    const stages = ["interested", "resume_ready", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const;
    assert.equal(countOpenPursuits(stages.map((status) => pursuit({ status }))), 5);
    assert.equal(countOpenPursuits([pursuit({ status: "rejected" }), pursuit({ status: "withdrawn" })]), 0);
    assert.equal(countOpenPursuits([]), 0);
});

test("trackerPageHeading carries the open count, singular and plural, and stays bare at zero", () => {
    assert.equal(trackerPageHeading(0), "Tracker");
    assert.equal(trackerPageHeading(1), "Tracker · 1 job");
    assert.equal(trackerPageHeading(12), "Tracker · 12 jobs");
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
