/**
 * Newer first among close matches (2026-09-30). The index ranks by words,
 * typo, sort, proximity, attributeRank, wordPosition, exactness and only then
 * `posted_ts:desc`, so an older posting could lead a newer one that matched
 * the query just as well, on word position and exactness alone. Index
 * settings stay as they are; relevance-sorted typed searches ask Meilisearch
 * for `showRankingScoreDetails` and `preferNewerAmongCloseMatches`
 * (meilisearch.ts) refills each close-match group's slots on the returned
 * page newest first.
 *
 * Pinned here: (a) the pure reorder — grouping, stability, page membership,
 * tier boundaries, detail stripping, and a caution hit landing after a fresh
 * clear one; (b) the request wiring — details requested only for relevance,
 * never for explicit sorts or the lanes, and never returned to the caller.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
    applyRelevanceQualityReranking,
    buildSearchBody,
    preferNewerAmongCloseMatches,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
} from "../../src/lib/jobs/meilisearch";
import type { PublicJob } from "../../src/lib/jobs/types";
import { mkJob } from "../support/jobs-corpus-stub";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

type Scores = { words?: number; typo?: number; proximity?: number; attributeRank?: number; wordPosition?: number; exactness?: number };

/** A hit as Meilisearch returns it with `showRankingScoreDetails: true`. */
function hit(id: string, daysOld: number | null, fields: Partial<PublicJob> = {}, scores: Scores = {}): PublicJob {
    const s = { typo: 1, proximity: 1, attributeRank: 1, wordPosition: 1, exactness: 1, ...scores };
    const details: Record<string, { order: number; score: number }> = {};
    let order = 0;
    for (const [rule, score] of Object.entries(s)) details[rule] = { order: order++, score };
    return {
        ...mkJob(id, { title: "Data Analyst", ghost_badge: "clear", ...fields }),
        posted_ts: daysOld == null ? undefined : NOW - daysOld * DAY_MS,
        _rankingScoreDetails: details,
    } as PublicJob;
}

const ids = (hits: PublicJob[]) => hits.map((h) => h.id);
const hasDetails = (h: PublicJob) => "_rankingScoreDetails" in h;

describe("preferNewerAmongCloseMatches — the pure reorder", () => {
    it("refills a close-match group's own slots newest first", () => {
        const page = [hit("old", 80), hit("mid", 20), hit("new", 1)];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["new", "mid", "old"]);
    });

    it("the motivating shape: 'Data Analyst' 80 days old vs 'Senior Data Analyst' posted yesterday, same page, differing only in word position and exactness", () => {
        const exact = hit("exact", 80, { title: "Data Analyst" }, { wordPosition: 1, exactness: 1 });
        const senior = hit("senior", 1, { title: "Senior Data Analyst" }, { wordPosition: 0.9, exactness: 0.7 });
        assert.deepEqual(ids(preferNewerAmongCloseMatches([exact, senior], "data analyst")), ["senior", "exact"]);
    });

    it("never groups hits that differ on words, typo, proximity or attributeRank", () => {
        for (const rule of ["words", "typo", "proximity", "attributeRank"] as const) {
            const page = [hit("better", 80, {}, { [rule]: 1 }), hit("worse-but-newer", 1, {}, { [rule]: 0.5 })];
            assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["better", "worse-but-newer"], rule);
        }
    });

    it("leaves other groups' slots alone — only a group's own members swap places", () => {
        // g = close-match group (typo 1), o = a worse typo score (its own group).
        const page = [hit("g-old", 60), hit("o-old", 50, {}, { typo: 0.5 }), hit("g-new", 2), hit("o-new", 1, {}, { typo: 0.5 })];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["g-new", "o-new", "g-old", "o-old"]);
    });

    it("is stable for equal posted_ts, and a missing posted_ts sorts last in its group", () => {
        const page = [hit("undated", null), hit("a", 5), hit("b", 5), hit("c", 3)];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["c", "a", "b", "undated"]);
    });

    it("keeps page membership: same hits, same count — nothing crosses a page boundary", () => {
        const page = Array.from({ length: 20 }, (_, i) => hit(`h${i}`, (i * 7) % 23, {}, { typo: i % 3 === 0 ? 0.5 : 1 }));
        const out = preferNewerAmongCloseMatches(page, "data analyst");
        assert.equal(out.length, page.length);
        assert.deepEqual([...ids(out)].sort(), [...ids(page)].sort());
    });

    it("never groups across federated tiers — separate queries, incomparable scores", () => {
        const page = [hit("strict-old", 70, { tier: 1 }), hit("whole-new", 1, { tier: 2 })];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["strict-old", "whole-new"]);
    });

    it("keeps the rerank's relevance tiers: a weaker title-coverage score never jumps a stronger one, however new", () => {
        // In-order "Data Analyst" scores higher than out-of-order "Analyst, Data"
        // (`titleRelevanceScore`), even when the engine's four rules tie.
        const page = [hit("in-order", 70, { title: "Data Analyst" }), hit("out-of-order", 1, { title: "Analyst, Data" })];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(page, "data analyst")), ["in-order", "out-of-order"]);
    });

    it("a caution hit sorts after a fresh non-ghost hit in the same tie group, even when the rerank put it first", () => {
        // Upstream may relabel age-only likely-ghost roles as `caution`. The
        // rerank's salary key puts the old caution role (salary shown) ahead
        // of the fresh clear one; within the close-match group recency wins.
        const caution = hit("caution-old", 75, { ghost_badge: "caution", salary_min: 90_000, salary_max: 110_000 });
        const fresh = hit("clear-fresh", 2, { ghost_badge: "clear" });
        const reranked = applyRelevanceQualityReranking([fresh, caution], "data analyst");
        assert.deepEqual(ids(reranked), ["caution-old", "clear-fresh"], "precondition: the rerank alone leads with the caution role");
        const out = preferNewerAmongCloseMatches(reranked, "data analyst");
        assert.deepEqual(ids(out), ["clear-fresh", "caution-old"]);
        assert.equal(out[1]!.ghost_badge, "caution", "the caution role stays on the page with its badge value intact");
    });

    it("hits without ranking details (lanes, the domain post-filter) keep their order", () => {
        const plain = [mkJob("x", { posted_ts: NOW - 50 * DAY_MS }), mkJob("y", { posted_ts: NOW - DAY_MS })];
        assert.deepEqual(ids(preferNewerAmongCloseMatches(plain, "data analyst")), ["x", "y"]);
    });

    it("strips _rankingScoreDetails from every hit it returns, grouped or not", () => {
        const page = [hit("a", 10), hit("b", 5, {}, { typo: 0.2 }), mkJob("plain")];
        const out = preferNewerAmongCloseMatches(page, "data analyst");
        assert.ok(out.every((h) => !hasDetails(h)), JSON.stringify(out.map((h) => Object.keys(h))));
        assert.ok(hasDetails(page[0]!), "the input page is not mutated");
    });
});

describe("buildSearchBody — the showRankingScoreDetails flag", () => {
    it("is absent by default and present only when asked for", () => {
        assert.equal("showRankingScoreDetails" in buildSearchBody({ q: "data analyst" }, false), false);
        assert.equal(buildSearchBody({ q: "data analyst" }, false, "all", { rankingScoreDetails: true }).showRankingScoreDetails, true);
    });
});

// ---- request wiring through searchMeili ----

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    mock.reset();
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

function jsonResponse(status: number, body: unknown) {
    const text = JSON.stringify(body);
    const res = {
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        json: async () => JSON.parse(text),
        clone() {
            return res;
        },
    };
    return res;
}

async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

type Call = { url: string; body: Record<string, unknown> };

function installMock(respond: (call: Call) => unknown): Call[] {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        const call = { url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> };
        calls.push(call);
        return jsonResponse(200, respond(call));
    });
    return calls;
}

describe("searchMeili — details requested for relevance only, never returned", () => {
    it("a relevance-sorted typed search asks for details, reorders the close matches and strips them", async () => {
        const q = "rust"; // a tech-skill query: plain single-index pass
        await primeNonCompanyIntent(q);
        const meiliOrder = [
            hit("exact-old", 80, { title: "Rust Engineer" }),
            hit("senior-new", 1, { title: "Senior Rust Engineer" }, { wordPosition: 0.8, exactness: 0.6 }),
        ];
        const calls = installMock(() => ({ hits: meiliOrder, totalHits: 2 }));

        const result = await searchMeili({ q, limit: 20, offset: 0 });

        const searches = calls.filter((c) => c.url.includes("/indexes/jobs/search"));
        assert.ok(searches.length >= 1);
        assert.ok(searches.every((c) => c.body.showRankingScoreDetails === true), JSON.stringify(searches.map((c) => c.body)));
        assert.deepEqual(ids(result.hits), ["senior-new", "exact-old"]);
        assert.ok(result.hits.every((h) => !hasDetails(h)), "score details must never reach the client");
        assert.equal(result.total, 2, "totals are untouched");
    });

    it("the federated tiered pass (bare role query) asks for details on both tiers and strips them", async () => {
        const q = "data analyst";
        await primeNonCompanyIntent(q);
        const rawHits = [
            { ...hit("s-old", 60), _federation: { queriesPosition: 0 } },
            { ...hit("s-new", 1), _federation: { queriesPosition: 0 } },
        ];
        const calls = installMock((c) =>
            c.url.endsWith("/multi-search") ? { hits: rawHits, estimatedTotalHits: 2 } : { estimatedTotalHits: 2 },
        );

        const result = await searchMeili({ q, limit: 20, offset: 0 });

        const fed = calls.find((c) => c.url.endsWith("/multi-search"));
        assert.ok(fed);
        const queries = fed!.body.queries as Record<string, unknown>[];
        assert.equal(queries.length, 2);
        assert.ok(queries.every((qb) => qb.showRankingScoreDetails === true), JSON.stringify(queries));
        assert.deepEqual(ids(result.hits), ["s-new", "s-old"]);
        assert.ok(result.hits.every((h) => !hasDetails(h) && !("_federation" in h)));
    });

    // Résumé-fit ranking is not a server sort (`JobSearchParams.sort` has no
    // "fit"): the client re-sorts the page by fit score (ranked.ts), so it
    // never sees an order this function produced except among equal fits.
    for (const sort of ["newest", "salary_desc"] as const) {
        it(`an explicit sort (${sort}) never asks for details and keeps the engine's order`, async () => {
            const q = "rust";
            await primeNonCompanyIntent(q);
            const page = [
                mkJob("a", { title: "Rust Engineer", posted_ts: NOW - DAY_MS, salary_max: 200_000 }),
                mkJob("b", { title: "Rust Engineer", posted_ts: NOW - 5 * DAY_MS, salary_max: 100_000 }),
            ];
            const calls = installMock(() => ({ hits: page, totalHits: 2 }));
            const result = await searchMeili({ q, sort, limit: 20, offset: 0 });
            assert.ok(calls.length > 0);
            assert.ok(calls.every((c) => !("showRankingScoreDetails" in c.body)), JSON.stringify(calls.map((c) => c.body)));
            assert.deepEqual(ids(result.hits), ["a", "b"]);
        });
    }

    it("the fit-phrase lane (quoted-OR phrases) never asks for details", async () => {
        const q = '"Product Manager" OR "Program Manager"';
        await primeNonCompanyIntent(q);
        const calls = installMock(() => ({ hits: [mkJob("pm", { title: "Product Manager" })], totalHits: 1 }));
        await searchMeili({ q, sort: "relevance" });
        assert.ok(calls.length >= 2);
        assert.ok(calls.every((c) => !("showRankingScoreDetails" in c.body)));
    });

    it("the role-title pair lane never asks for details", async () => {
        const q = "director product";
        await primeNonCompanyIntent(q);
        const calls = installMock(() => ({ hits: [mkJob("d", { title: "Director of Product" })], totalHits: 1 }));
        await searchMeili({ q, sort: "relevance" });
        assert.ok(calls.length >= 1);
        assert.ok(calls.every((c) => !("showRankingScoreDetails" in c.body)));
    });

    it("an empty-query browse (resolves to newest) never asks for details", async () => {
        const calls = installMock(() => ({ hits: [], totalHits: 0 }));
        await searchMeili({ q: "", limit: 20, offset: 0 });
        assert.ok(calls.every((c) => !("showRankingScoreDetails" in c.body)));
    });
});
