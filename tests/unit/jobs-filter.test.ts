import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilter } from "../../src/lib/jobs/meilisearch";

test("hideGhosts adds the ghost exclusion clause", () => {
    const f = buildFilter({ hideGhosts: true });
    assert.ok(f.some((c) => c.includes("ghost_badge !=") && c.includes("likely_ghost")), JSON.stringify(f));
});

test("hideGhosts absent/false adds no ghost clause", () => {
    for (const p of [{}, { hideGhosts: false }]) {
        const f = buildFilter(p);
        assert.ok(!f.some((c) => c.includes("ghost_badge !=")), JSON.stringify(f));
    }
});

test("hideGhosts composes with an explicit ghost_badge facet", () => {
    const f = buildFilter({ hideGhosts: true, facets: { ghost_badge: ["clear"] } });
    assert.ok(f.some((c) => c.includes("ghost_badge !=")));
    assert.ok(f.some((c) => c.includes('"clear"') || c.includes("'clear'") || c.includes("= clear")), JSON.stringify(f));
});

// countNewSinceAction's posted_ts chokepoint (actions/jobs.ts) — an
// absolute cursor floor, expressed through the SAME buildFilter translation
// postedBucket already uses, not a hand-built filter string.
test("postedSinceMs adds an absolute posted_ts >= floor clause", () => {
    const f = buildFilter({ postedSinceMs: 1_800_000_000_000 });
    assert.ok(f.some((c) => c === "posted_ts >= 1800000000000"), JSON.stringify(f));
});

test("postedSinceMs absent adds no posted_ts clause", () => {
    const f = buildFilter({});
    assert.ok(!f.some((c) => c.includes("posted_ts")), JSON.stringify(f));
});

test("postedSinceMs and postedBucket compose additively (both clauses present) when both are set", () => {
    const f = buildFilter({ postedBucket: "7d", postedSinceMs: 1_800_000_000_000 });
    assert.ok(f.some((c) => c.startsWith("posted_ts >= ") && c.includes("1800000000000")), JSON.stringify(f));
    assert.ok(f.filter((c) => c.includes("posted_ts")).length === 2, JSON.stringify(f));
});

test("postedSinceMs drops out under the TRANSITIONAL legacy retry, same as postedBucket", () => {
    const f = buildFilter({ postedSinceMs: 1_800_000_000_000 }, true);
    assert.ok(!f.some((c) => c.includes("posted_ts")), JSON.stringify(f));
});

test("filter clauses are commutative — facet object key order does not change the clause set", () => {
    const forward = buildFilter({
        facets: { work_type: ["remote"], experience_level: ["senior"] },
    });
    const reversed = buildFilter({
        facets: { experience_level: ["senior"], work_type: ["remote"] },
    });
    assert.deepEqual([...forward].sort(), [...reversed].sort());
});
