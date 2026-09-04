/**
 * 2026-09-04 prod incident: the role-title lane (`shouldRunRoleTitleLane`,
 * fetchRoleTitleLaneHits) only ran under `isRelevance` in `runWithIntent`
 * (meilisearch.ts) — every other sort fell through to plain `runSearch()`
 * against the FULL corpus instead of the lane's title-scoped pool. A sort is
 * supposed to be a permutation of one result set, never a second, larger
 * filter. Measured totals for the same query, three sorts:
 *   "director of marketing": relevance 1209 vs newest/salary_desc 33231
 *   "junior developer":      relevance  896 vs newest/salary_desc 35710
 *   "vp product":            relevance 2737 vs newest/salary_desc 11755
 * These tests pin the invariant: `total` (and the underlying pool) must be
 * IDENTICAL across relevance/newest/salary_desc for a lane query. Coverage
 * spans two different lane-triggering queries ("director of marketing", the
 * bug instance, and "vp product", a different seniority+role pair — proving
 * the fix is class-wide, not specific to one phrase) plus a non-lane query
 * (no seniority phrase, so `shouldRunRoleTitleLane` is false) to prove the
 * plain-search path's set-invariance was never broken by this change.
 *
 * SECOND DEFECT, SAME BUG CLASS (found via live probe on "vp product" after
 * the first fix landed): both lane fetchers (`fetchRoleTitleLaneHits`,
 * `fetchCompanyScopedLaneHits`) cap each sub-query's hits (1000 / 100) but
 * spread the CALLER's params into the sub-query body, so the caller's `sort`
 * reached Meili's `sort` param on a capped fetch. A capped fetch's top-N is
 * only stable under a fixed ORDER BY — a pair whose match count exceeds the
 * cap (e.g. "director product": 2850 matches > the 1000 cap) returns a
 * DIFFERENT top-N per requested sort, making lane membership sort-dependent
 * again, just one level deeper. Fix: both fetchers pin `sort: "relevance"`
 * on every sub-query body regardless of the caller's requested sort — the
 * caller reorders the assembled, deduped union afterward. The tests below
 * simulate the cap biting by keying the mocked lane response on whether the
 * request body carries a `sort` field at all.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
} from "../../src/lib/jobs/meilisearch";
import type { PublicJob } from "../../src/lib/jobs/types";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Engineer",
        company: "Acme",
        company_domain: null,
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

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

/** Pre-warms the company-intent cache with an empty result so the intent
 *  probe fired for any non-empty q doesn't add noise to the mock installed
 *  after this resolves — same pattern as jobs-sort-integrity.test.ts. */
async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

// Lane pool: every mocked fetch (each role-title pair query fires one) returns
// this same three-doc set, so after de-dup the lane pool is these three docs
// regardless of how many pair queries the query text expands into.
const LANE_POOL = [
    job({ id: "a", title: "VP Marketing", posted_at: "2026-01-05T00:00:00Z", salary_max: 120_000 }),
    job({ id: "b", title: "Head of Marketing", posted_at: "2026-01-10T00:00:00Z", salary_max: 90_000 }),
    job({ id: "c", title: "Chief Marketing Officer", posted_at: "2026-01-01T00:00:00Z", salary_max: 200_000 }),
];

describe("searchMeili role-title lane defines membership for every sort (set invariance)", () => {
    it("director of marketing: identical total and pool across relevance/newest/salary_desc", async () => {
        const q = "director of marketing";
        await primeNonCompanyIntent(q);
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: LANE_POOL, totalHits: LANE_POOL.length }));

        const relevance = await searchMeili({ q, sort: "relevance" });
        const newest = await searchMeili({ q, sort: "newest" });
        const salary = await searchMeili({ q, sort: "salary_desc" });

        assert.equal(relevance.total, 3, "lane pool size, not the full-corpus fallback");
        assert.equal(newest.total, relevance.total, "newest must not filter down to a different pool");
        assert.equal(salary.total, relevance.total, "salary_desc must not filter down to a different pool");

        assert.deepEqual(
            new Set(relevance.hits.map((h) => h.id)),
            new Set(newest.hits.map((h) => h.id)),
            "newest is a permutation of the same doc set as relevance",
        );
        assert.deepEqual(
            new Set(relevance.hits.map((h) => h.id)),
            new Set(salary.hits.map((h) => h.id)),
            "salary_desc is a permutation of the same doc set as relevance",
        );

        assert.deepEqual(newest.hits.map((h) => h.id), ["b", "a", "c"], "newest-first order within the lane pool");
        assert.deepEqual(salary.hits.map((h) => h.id), ["c", "a", "b"], "salary-descending order within the lane pool");
    });

    it("vp product: same invariant holds for a different seniority+role pair (proves class-wide, not one phrase)", async () => {
        const q = "vp product";
        await primeNonCompanyIntent(q);
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: LANE_POOL, totalHits: LANE_POOL.length }));

        const relevance = await searchMeili({ q, sort: "relevance" });
        const newest = await searchMeili({ q, sort: "newest" });
        const salary = await searchMeili({ q, sort: "salary_desc" });

        assert.equal(relevance.total, 3);
        assert.equal(newest.total, relevance.total);
        assert.equal(salary.total, relevance.total);
        assert.deepEqual(newest.hits.map((h) => h.id), ["b", "a", "c"]);
        assert.deepEqual(salary.hits.map((h) => h.id), ["c", "a", "b"]);
    });

    it("non-lane query (no seniority phrase): plain-search path stays sort-invariant too", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);

        const page = [
            job({ id: "x", title: "Software Engineer", posted_at: "2026-01-05T00:00:00Z", salary_max: 150_000 }),
            job({ id: "y", title: "Software Engineer", posted_at: "2026-01-10T00:00:00Z", salary_max: 90_000 }),
            job({ id: "z", title: "Software Engineer", posted_at: "2026-01-01T00:00:00Z", salary_max: 200_000 }),
        ];
        // Full page (>= RELAX_MIN_HITS) so the thin-result relax pass doesn't
        // fire and the sort-integrity guard sees an already-sorted page (no
        // retry) for newest/salary_desc.
        mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { sort?: string[] };
            let hits = page;
            if (body.sort?.[0]?.startsWith("posted_ts")) {
                hits = [...page].sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
            } else if (body.sort?.[0]?.startsWith("salary_max")) {
                hits = [...page].sort((a, b) => (b.salary_max ?? 0) - (a.salary_max ?? 0));
            }
            return jsonResponse(200, { hits, totalHits: 25 });
        });

        const relevance = await searchMeili({ q, sort: "relevance" });
        const newest = await searchMeili({ q, sort: "newest" });
        const salary = await searchMeili({ q, sort: "salary_desc" });

        assert.equal(relevance.total, 25);
        assert.equal(newest.total, relevance.total, "no seniority phrase — lane never fires, so this was never the bug, but must stay invariant");
        assert.equal(salary.total, relevance.total);
    });
});

// FULL_SET is what a sub-query returns when its body carries no `sort`
// (pinned to relevance, today's fixed behavior). TRUNCATED_SET is what an
// UNPINNED capped sub-query would return once its match count exceeds the
// cap and the caller's sort reaches Meili — a different top-N, missing "p3".
const FULL_SET = [
    job({ id: "p1", title: "VP Marketing" }),
    job({ id: "p2", title: "Head of Marketing" }),
    job({ id: "p3", title: "Chief Marketing Officer" }),
];
const TRUNCATED_SET = [
    job({ id: "p1", title: "VP Marketing" }),
    job({ id: "p2", title: "Head of Marketing" }),
];

describe("role-title lane sub-queries are pinned to relevance (cap is only sort-safe under a fixed order)", () => {
    it("stays sort-invariant even when an unpinned sub-query would have returned a truncated top-N", async () => {
        const q = "director of marketing";
        await primeNonCompanyIntent(q);

        // Every pair sub-query (fetchRoleTitleLaneHits) hits this same URL.
        // Key the response on whether `sort` is present in the body — that's
        // exactly what an unpinned, over-the-cap sub-query would produce
        // under newest/salary_desc vs. relevance.
        mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { sort?: string[] };
            const hits = body.sort ? TRUNCATED_SET : FULL_SET;
            return jsonResponse(200, { hits, totalHits: hits.length });
        });

        const relevance = await searchMeili({ q, sort: "relevance" });
        const newest = await searchMeili({ q, sort: "newest" });
        const salary = await searchMeili({ q, sort: "salary_desc" });

        assert.equal(relevance.total, 3, "sub-queries pinned to relevance — always the full pool");
        assert.equal(newest.total, relevance.total, "would be 2 (TRUNCATED_SET) if the caller's sort leaked into the capped sub-query");
        assert.equal(salary.total, relevance.total);
        assert.deepEqual(new Set(newest.hits.map((h) => h.id)), new Set(relevance.hits.map((h) => h.id)));
        assert.deepEqual(new Set(salary.hits.map((h) => h.id)), new Set(relevance.hits.map((h) => h.id)));
    });
});

describe("company-scoped lane sub-queries are pinned to relevance (same cap defect, second site)", () => {
    it("stays sort-invariant for a company-name query with a work_type facet even when an unpinned sub-query would have truncated differently", async () => {
        const q = "acme";
        // isCompanyNameQuery needs >= COMPANY_INTENT_MIN_EXACT (3) exact
        // matches at >= COMPANY_INTENT_MIN_RATIO (0.6) — 5/5 "Acme" clears
        // both floors, so `runWithIntent` resolves companyScoped = true.
        // `facets.work_type` gives `hasCompanyLaneConstraints` a place/mode
        // constraint, which is what actually triggers the lane
        // (`shouldRunCompanyScopedLanes`). The intent probe's own request
        // shape (`hitsPerPage`/`page`, no `limit`) distinguishes it from the
        // lane's capped sub-queries (`limit`/`offset`) in the router below;
        // the intent result is cached after the first call, same as prod.
        const params = { q, facets: { work_type: ["remote"] } };

        mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { sort?: string[]; hitsPerPage?: number };
            if (body.hitsPerPage !== undefined) {
                return jsonResponse(200, {
                    hits: Array.from({ length: 5 }, () => ({ company: "Acme", company_domain: "acme.com" })),
                    totalHits: 5,
                });
            }
            const hits = body.sort ? TRUNCATED_SET : FULL_SET;
            return jsonResponse(200, { hits, totalHits: hits.length });
        });

        const relevance = await searchMeili({ ...params, sort: "relevance" });
        const newest = await searchMeili({ ...params, sort: "newest" });
        const salary = await searchMeili({ ...params, sort: "salary_desc" });

        assert.equal(relevance.total, 3, "sub-queries pinned to relevance — always the full pool");
        assert.equal(newest.total, relevance.total, "would be 2 (TRUNCATED_SET) if the caller's sort leaked into the capped sub-query");
        assert.equal(salary.total, relevance.total);
        assert.deepEqual(new Set(newest.hits.map((h) => h.id)), new Set(relevance.hits.map((h) => h.id)));
        assert.deepEqual(new Set(salary.hits.map((h) => h.id)), new Set(relevance.hits.map((h) => h.id)));
    });
});
