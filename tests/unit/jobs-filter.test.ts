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
