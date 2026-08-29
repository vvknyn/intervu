import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildViewedSet, applyViewedFilter } from "@/lib/views/viewed-set";
import { orderJobViewsLatestFirst, MAX_JOB_VIEWS, type JobView } from "@/lib/views/types";

function view(id: string, lastViewedAt: string, overrides: Partial<JobView> = {}): JobView {
    return {
        id: `u_${id}`,
        user_id: "u",
        job_id: id,
        first_viewed_at: lastViewedAt,
        last_viewed_at: lastViewedAt,
        view_count: 1,
        job_snapshot: {
            title: `Job ${id}`,
            company: "Acme",
            location: null,
            description: "",
            apply_url: "https://example.com/apply",
        },
        ...overrides,
    };
}

describe("buildViewedSet", () => {
    it("unions all three tiers and dedupes overlapping ids", () => {
        const set = buildViewedSet(["a", "b"], ["b", "c"], ["c", "d"]);
        assert.deepEqual([...set].sort(), ["a", "b", "c", "d"]);
    });

    it("returns an empty set when all three tiers are empty", () => {
        const set = buildViewedSet([], [], []);
        assert.equal(set.size, 0);
    });

    it("handles a single non-empty tier with the other two empty", () => {
        const set = buildViewedSet([], ["only"], []);
        assert.deepEqual([...set], ["only"]);
    });
});

describe("applyViewedFilter", () => {
    const hits = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("passes hits through untouched when the toggle is off, even if all are viewed", () => {
        const viewed = new Set(["a", "b", "c"]);
        assert.deepEqual(applyViewedFilter(hits, viewed, false), hits);
    });

    it("hides only the viewed hits when the toggle is on", () => {
        const viewed = new Set(["b"]);
        const result = applyViewedFilter(hits, viewed, true);
        assert.deepEqual(result.map((h) => h.id), ["a", "c"]);
    });

    it("never drops an un-viewed hit even when the viewed set is non-empty", () => {
        const viewed = new Set(["z"]); // no overlap with hits at all
        const result = applyViewedFilter(hits, viewed, true);
        assert.deepEqual(result, hits);
    });
});

describe("orderJobViewsLatestFirst", () => {
    it("sorts newest last_viewed_at first", () => {
        const views = [
            view("a", "2026-08-01T00:00:00.000Z"),
            view("b", "2026-08-03T00:00:00.000Z"),
            view("c", "2026-08-02T00:00:00.000Z"),
        ];
        const sorted = orderJobViewsLatestFirst(views);
        assert.deepEqual(sorted.map((v) => v.job_id), ["b", "c", "a"]);
    });

    it("caps the result at MAX_JOB_VIEWS without mutating the input array", () => {
        const views = Array.from({ length: MAX_JOB_VIEWS + 10 }, (_, i) =>
            view(`j${i}`, new Date(2026, 0, 1 + i).toISOString()),
        );
        const sorted = orderJobViewsLatestFirst(views);
        assert.equal(sorted.length, MAX_JOB_VIEWS);
        assert.equal(views.length, MAX_JOB_VIEWS + 10);
        // Newest (highest day offset) should be first.
        assert.equal(sorted[0].job_id, `j${MAX_JOB_VIEWS + 9}`);
    });

    it("keeps a below-cap list intact, in sorted order", () => {
        const views = [view("x", "2026-08-01T00:00:00.000Z")];
        const sorted = orderJobViewsLatestFirst(views);
        assert.deepEqual(sorted, views);
    });
});
