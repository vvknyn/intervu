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
        assert.deepEqual(specs, [[1, 100], [2, 0.01]]);
    });

    it("a filter that admits un-derived rows adds the unknown-inclusive queries at their group's weight, not a step below", () => {
        const specs = weightsOf({ q: "physical therapist", sort: "newest", salaryMin: 100_000 } as JobSearchParams);
        assert.deepEqual(specs.filter(([t]) => t === 1).map(([, w]) => w).filter((w, i, all) => all.indexOf(w) === i), [100]);
        assert.deepEqual(specs.filter(([t]) => t === 2).map(([, w]) => w), [0.01, 0.01]);
    });

    it("every typed query asks for the engine's score details (the guard reads the typo bucket), ", () => {
        assert.ok(buildTieredQuerySpecs({ q: "welder", sort: "newest" }).every((s) => (s.query as { showRankingScoreDetails?: boolean }).showRankingScoreDetails === true));
    });
});

describe("group weights under Relevance keep the known-first steps", () => {
    for (const q of ["speech therapist", "physical therapist"]) {
        it(`${q}: typed known 100 > typed inclusive 50 > alias known 10 > alias inclusive 5 > whole document 0.01 and 0.005`, () => {
            const w = federationWeights({ q, sort: "relevance" });
            assert.equal(w.typed, 100);
            assert.equal(w.typed * w.unknownFactor, 50);
            assert.equal(w.alias, 10);
            assert.equal(w.alias * w.unknownFactor, 5);
            assert.equal(w.wholeDocument, 0.01);
            assert.ok(w.alias * w.unknownFactor > w.wholeDocument, "every alias still ranks above the divider's other side");
        });
    }

    it("the relevance request for a bare query is unchanged: typed 100, whole document 0.01", () => {
        assert.deepEqual(weightsOf({ q: "welder" }), [[1, 100], [2, 0.01]]);
    });
});

describe("the divider's label tells the truth about both sides", () => {
    const hit = (id: string, tier: 1 | 2) => ({ id, tier }) as PublicJob;

    it("counts the cards above as shown and the cards below as the rest of the whole result", () => {
        const loaded = [...Array.from({ length: 11 }, (_, i) => hit(`a${i}`, 1)), ...Array.from({ length: 20 }, (_, i) => hit(`b${i}`, 2))];
        assert.equal(
            tieredSeamSummary(11, { total: 119, hits: loaded }),
            "11 roles match by title, company or keywords · 108 more mention it elsewhere in the posting",
        );
    });

    it("'hide viewed' shrinks what is shown above, never the count below", () => {
        const loaded = [...Array.from({ length: 11 }, (_, i) => hit(`a${i}`, 1)), hit("b", 2)];
        assert.match(tieredSeamSummary(9, { total: 119, hits: loaded }), /^9 roles match .* · 108 more mention it/);
    });

    it("takes the whole result's total even when the strict count differs (physical therapist, software engineer)", () => {
        for (const [total, strictCount, above] of [[60, 3, 10], [250, 40, 25]] as const) {
            const hits = [...Array.from({ length: above }, (_, i) => hit(`a${i}`, 1)), hit("b", 2)];
            const text = tieredSeamSummary(above, { total, tier1Total: strictCount, hits } as Parameters<typeof tieredSeamSummary>[1]);
            assert.ok(text.endsWith(`${(total - above).toLocaleString()} more mention it elsewhere in the posting`), text);
        }
    });

    it("reads as singular for one role", () => {
        assert.match(tieredSeamSummary(1, { total: 6, hits: [hit("a", 1), hit("b", 2)] }), /^1 role matches by title, company or keywords/);
    });

    it("never prints a negative count", () => {
        assert.match(tieredSeamSummary(3, { total: 2, hits: [hit("a", 1), hit("b", 1), hit("c", 1)] }), / · 0 more /);
    });

    it("the divider is placed at the first hit below it, and not at all when none is loaded", () => {
        assert.equal(tieredSeamIndex([hit("a", 1), hit("b", 1), hit("c", 2)]), 2);
        assert.equal(tieredSeamIndex([hit("a", 1), hit("b", 1)]), -1);
    });
});

describe("the divider is structural: every tier-1 hit outranks every tier-2 hit", () => {
    // Weight multiplies the ranking score, so a hit of score s under weight w ranks at w * s. A tier-1 hit whose score
    // is as low as MIN_SCORE must still beat a tier-2 hit scoring a perfect 1.
    const MIN_SCORE = 0.01;
    const SORTS_AND_RELEVANCE = ["relevance", "newest", "salary_desc"] as const;
    for (const q of ["speech therapist", "physical therapist", "software engineer", "welder"]) {
        for (const sort of SORTS_AND_RELEVANCE) {
            for (const salaryMin of [undefined, 100_000]) {
                it(`${q} / ${sort}${salaryMin ? " / salary floor" : ""}`, () => {
                    const specs = weightsOf({ q, sort, ...(salaryMin ? { salaryMin } : {}) } as JobSearchParams);
                    const [one, two] = [1, 2].map((tier) => specs.filter(([t]) => t === tier).map(([, w]) => w));
                    assert.ok(one.length > 0 && two.length > 0);
                    assert.ok(Math.min(...one) * MIN_SCORE > Math.max(...two), `tier 1 floor ${Math.min(...one)}, tier 2 ceiling ${Math.max(...two)}`);
                });
            }
        }
    }

    it("tier 2 keeps its known:inclusive ratio, so the known-first step survives the scaling", () => {
        const [known, inclusive] = [federationWeights({ q: "welder", sort: "relevance" })].flatMap((w) => [w.wholeDocument, w.wholeDocument * w.unknownFactor]);
        assert.equal(inclusive / known, 0.5);
        const w = federationWeights({ q: "welder", sort: "newest" });
        assert.equal(w.wholeDocument * w.unknownFactor, w.wholeDocument);
    });
});
