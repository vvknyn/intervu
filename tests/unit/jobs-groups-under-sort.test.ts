/**
 * Typed-search results under an explicit sort (prod, "speech therapist" + Freshest, 2026-10-26): the divider sat
 * at the first alias hit, a known-value hit (weight 100) from 2 months ago came before an inclusive hit (weight 50)
 * from 18 days ago, and "M more" was not a count of the cards below.
 *
 * Meilisearch 1.45.2 federation, probed locally: queries with EQUAL weights merge by the sort value; queries with
 * different weights form bands, each keeping its own sort order. So under an explicit sort the two groups (above and
 * below the divider) are the only weight step, and every query of one group carries one weight.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTieredQuerySpecs, federationWeights } from "../../src/lib/jobs/meilisearch";
import { tieredSeamSummary, tieredSeamIndex } from "../../src/lib/jobs/presentation";
import type { JobSearchParams, PublicJob } from "../../src/lib/jobs/types";

const weightsOf = (p: JobSearchParams) => buildTieredQuerySpecs(p).map((s) => [s.tier, s.query.federationOptions.weight] as const);
const SORTS = ["newest", "salary_desc"] as const;

describe("group weights under an explicit sort", () => {
    for (const q of ["speech therapist", "physical therapist"]) {
        for (const sort of SORTS) {
            it(`${q} / ${sort}: every query above the divider shares one weight, every query below shares a lower one`, () => {
                const specs = weightsOf({ q, sort });
                const above = specs.filter(([tier]) => tier === 1).map(([, w]) => w);
                const below = specs.filter(([tier]) => tier === 2).map(([, w]) => w);
                assert.ok(specs.length > 2, "the aliases are queries of their own");
                assert.equal(new Set(above).size, 1, `above: ${above}`);
                assert.equal(new Set(below).size, 1, `below: ${below}`);
                assert.ok(above[0] > below[0] * 10, "a group's weight outranks the other group's even at one typo");
            });
        }
    }

    it("an alias title hit is above the divider", () => {
        const aliases = buildTieredQuerySpecs({ q: "physical therapist", sort: "newest" }).filter((s) => s.query.attributesToSearchOn?.join() === "title");
        assert.ok(aliases.length > 0);
        assert.ok(aliases.every((s) => s.tier === 1));
    });

    it("a query with no aliases is the two typed queries, same rule", () => {
        const specs = weightsOf({ q: "welder", sort: "newest" });
        assert.deepEqual(specs, [[1, 100], [2, 1]]);
    });

    it("a filter that admits un-derived rows adds the unknown-inclusive queries at their group's weight, not a step below", () => {
        const specs = weightsOf({ q: "physical therapist", sort: "newest", salaryMin: 100_000 } as JobSearchParams);
        assert.deepEqual(specs.filter(([t]) => t === 1).map(([, w]) => w).filter((w, i, all) => all.indexOf(w) === i), [100]);
        assert.deepEqual(specs.filter(([t]) => t === 2).map(([, w]) => w), [1, 1]);
    });

    it("every typed query asks for the engine's score details (the guard reads the typo bucket), ", () => {
        assert.ok(buildTieredQuerySpecs({ q: "welder", sort: "newest" }).every((s) => (s.query as { showRankingScoreDetails?: boolean }).showRankingScoreDetails === true));
    });
});

describe("group weights under Relevance keep the known-first steps", () => {
    for (const q of ["speech therapist", "physical therapist"]) {
        it(`${q}: typed known 100 > typed inclusive 50 > alias known 10 > alias inclusive 5 > whole document 1 and 0.5`, () => {
            const w = federationWeights({ q, sort: "relevance" });
            assert.equal(w.typed, 100);
            assert.equal(w.typed * w.unknownFactor, 50);
            assert.equal(w.alias, 10);
            assert.equal(w.alias * w.unknownFactor, 5);
            assert.equal(w.wholeDocument, 1);
            assert.ok(w.alias * w.unknownFactor > w.wholeDocument, "every alias still ranks above the divider's other side");
        });
    }

    it("the relevance request for a bare query is unchanged: typed 100, whole document 1", () => {
        assert.deepEqual(weightsOf({ q: "welder" }), [[1, 100], [2, 1]]);
    });
});

describe("the divider's label tells the truth about both sides", () => {
    const hit = (id: string, tier: 1 | 2) => ({ id, tier }) as PublicJob;

    it("counts the cards above as shown and the cards below as the rest of the whole result", () => {
        const loaded = [...Array.from({ length: 11 }, (_, i) => hit(`a${i}`, 1)), ...Array.from({ length: 20 }, (_, i) => hit(`b${i}`, 2))];
        assert.equal(
            tieredSeamSummary(11, 119, loaded),
            "11 roles match every word in the title, company or keywords, or a title for the same job · 108 more have them elsewhere in the posting",
        );
    });

    it("'hide viewed' shrinks what is shown above, never the count below", () => {
        const loaded = [...Array.from({ length: 11 }, (_, i) => hit(`a${i}`, 1)), hit("b", 2)];
        assert.match(tieredSeamSummary(9, 119, loaded), /^9 roles match .* · 108 more have them/);
    });

    it("reads as singular for one role", () => {
        assert.match(tieredSeamSummary(1, 6, [hit("a", 1), hit("b", 2)]), /^1 role matches every word/);
    });

    it("never prints a negative count", () => {
        assert.match(tieredSeamSummary(3, 2, [hit("a", 1), hit("b", 1), hit("c", 1)]), / · 0 more /);
    });

    it("the divider is placed at the first hit below it, and not at all when none is loaded", () => {
        assert.equal(tieredSeamIndex([hit("a", 1), hit("b", 1), hit("c", 2)]), 2);
        assert.equal(tieredSeamIndex([hit("a", 1), hit("b", 1)]), -1);
    });
});
