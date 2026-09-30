import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
    HUB_RECENT_ROWS,
    HUB_TRACKER_ROWS,
    hubRecentRows,
    hubTrackerAgeLabel,
    hubTrackerRows,
    hubTrackerStaleLabel,
    hubTrackerStats,
} from "@/lib/jobs/for-you/hub-your-jobs";
import {
    getSessionViewsSnapshot,
    mergeSessionViews,
    noteSessionView,
    resetSessionViewsForTest,
} from "@/lib/views/session-views";
import { signupGateCopy } from "@/lib/auth/auth-gate-copy";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import type { JobView } from "@/lib/views/types";

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function pursuit(id: string, status: PursuitStage, updatedH: number, extra: Partial<Pursuit> = {}): Pursuit {
    return {
        id,
        user_id: "u",
        company_name: "Acme",
        position: `Role ${id}`,
        status,
        created_at: hoursAgo(updatedH + 24),
        updated_at: hoursAgo(updatedH),
        ...extra,
    };
}

function view(jobId: string, lastH: number, count = 1): JobView {
    return {
        id: `u_${jobId}`,
        user_id: "u",
        job_id: jobId,
        first_viewed_at: hoursAgo(lastH + 100),
        last_viewed_at: hoursAgo(lastH),
        view_count: count,
        job_snapshot: { title: `Job ${jobId}`, company: "Acme", location: null, apply_url: "https://example.com" },
    };
}

const snapshot = (title: string) => ({ title, company: "Acme", location: null, apply_url: "https://example.com" });

describe("hubTrackerRows", () => {
    it("lists sent roles before saved ones, interviews first, and leaves closed roles to the tracker", () => {
        const rows = hubTrackerRows([
            pursuit("saved-new", "interested", 1),
            pursuit("applied-old", "applied", 50),
            pursuit("rejected", "rejected", 0),
            pursuit("interview", "interviewing", 90),
            pursuit("offer", "offer", 10),
            pursuit("resume-ready", "resume_ready", 5),
            pursuit("withdrawn", "withdrawn", 2),
        ]);
        assert.deepEqual(
            rows.map((p) => p.id),
            ["interview", "offer", "applied-old", "saved-new", "resume-ready"],
        );
    });

    it("caps at the hub's row count", () => {
        const many = Array.from({ length: 10 }, (_, i) => pursuit(`p${i}`, "applied", i));
        assert.equal(hubTrackerRows(many).length, HUB_TRACKER_ROWS);
    });
});

describe("hubTrackerStats", () => {
    it("counts the /yours chip buckets, applied first, and says Offer for one", () => {
        const stats = hubTrackerStats([
            pursuit("a", "applied", 1),
            pursuit("b", "applied", 2),
            pursuit("c", "interviewing", 3),
            pursuit("d", "offer", 4),
            pursuit("e", "interested", 5),
            pursuit("f", "resume_ready", 6),
            pursuit("g", "rejected", 7),
        ]);
        assert.deepEqual(
            stats.map((s) => [s.label, s.value]),
            [
                ["Applied", 2],
                ["Interviewing", 1],
                ["Offer", 1],
                ["Saved", 2],
            ],
        );
        assert.equal(hubTrackerStats([]).find((s) => s.key === "offer")?.label, "Offers");
    });
});

describe("hubTrackerAgeLabel / hubTrackerStaleLabel", () => {
    it("dates a sent role by when it was applied and a saved one by when it was saved", () => {
        assert.equal(hubTrackerAgeLabel(pursuit("a", "applied", 1, { applied_at: hoursAgo(72) }), NOW), "applied 3d ago");
        assert.equal(hubTrackerAgeLabel(pursuit("s", "interested", 2, { created_at: hoursAgo(5) }), NOW), "saved 5h ago");
        // Sent with no applied_at on file: never invents an application date.
        assert.equal(hubTrackerAgeLabel(pursuit("i", "interviewing", 1, { created_at: hoursAgo(48) }), NOW), "tracked 2d ago");
    });

    it("flags only an application with no update past the tracker's stale threshold", () => {
        assert.equal(hubTrackerStaleLabel(pursuit("a", "applied", 20 * 24), NOW), "no update in 20d");
        assert.equal(hubTrackerStaleLabel(pursuit("b", "applied", 2 * 24), NOW), null);
        assert.equal(hubTrackerStaleLabel(pursuit("c", "interviewing", 20 * 24), NOW), null);
    });
});

describe("hubRecentRows", () => {
    it("keeps the newest 20", () => {
        const views = Array.from({ length: 30 }, (_, i) => view(`j${i}`, i));
        const rows = hubRecentRows(views);
        assert.equal(rows.length, HUB_RECENT_ROWS);
        assert.equal(rows[0]?.job_id, "j0");
    });
});

describe("mergeSessionViews", () => {
    it("puts a job opened on this page first, before the server list has it", () => {
        const merged = mergeSessionViews(
            [view("old", 5), view("older", 10)],
            [{ job_id: "new", viewed_at: hoursAgo(0), job_snapshot: snapshot("New role") }],
        );
        assert.deepEqual(
            merged.map((v) => v.job_id),
            ["new", "old", "older"],
        );
        assert.equal(merged[0]?.job_snapshot.title, "New role");
        assert.equal(merged[0]?.view_count, 1);
    });

    it("moves a re-opened job to the top once, keeping its first view and counting this open", () => {
        const server = [view("a", 1), view("b", 48, 3)];
        const merged = mergeSessionViews(server, [{ job_id: "b", viewed_at: hoursAgo(0), job_snapshot: snapshot("B") }]);
        assert.deepEqual(
            merged.map((v) => v.job_id),
            ["b", "a"],
        );
        assert.equal(merged[0]?.id, "u_b");
        assert.equal(merged[0]?.first_viewed_at, server[1]?.first_viewed_at);
        assert.equal(merged[0]?.view_count, 4);
    });

    it("leaves a server row that is already newer than the note alone", () => {
        const server = [view("a", 0)];
        const merged = mergeSessionViews(server, [{ job_id: "a", viewed_at: hoursAgo(3), job_snapshot: snapshot("A") }]);
        assert.deepEqual(merged, server);
    });

    it("returns the server list untouched when nothing was opened on this page", () => {
        const server = [view("a", 0)];
        assert.equal(mergeSessionViews(server, []), server);
    });
});

describe("noteSessionView", () => {
    beforeEach(() => resetSessionViewsForTest());

    it("says first only once per job, and keeps the latest open on top", () => {
        assert.equal(noteSessionView("a", snapshot("A"), new Date(NOW - 2000)), true);
        assert.equal(noteSessionView("b", snapshot("B"), new Date(NOW - 1000)), true);
        assert.equal(noteSessionView("a", snapshot("A"), new Date(NOW)), false);
        assert.deepEqual(
            getSessionViewsSnapshot().map((v) => v.job_id),
            ["a", "b"],
        );
    });

    it("ignores an empty id", () => {
        assert.equal(noteSessionView("  ", snapshot("x")), false);
        assert.equal(getSessionViewsSnapshot().length, 0);
    });
});

describe("the signed-out gate under the packs", () => {
    it("names what the visitor gets, not a single application", () => {
        assert.equal(signupGateCopy("tracker").title, "See the roles you've applied to and viewed");
    });
});
