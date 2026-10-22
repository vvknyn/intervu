/**
 * Sep 10 2026 — `/jobs` showed 589 "software engineer" jobs in Canada while
 * the whole-document pool is 2,231. Root cause (commit e69d1e18): a bare
 * role query's title/company/tags-scoped pass (`titleFirstScoped`) was made
 * the ONLY pass — the whole-document pass ran only on a zero-hit miss — so
 * genuine whole-document matches were dropped from the pool, not merely
 * ranked behind the strict-scope matches.
 *
 * Fix (`runTieredRetrieval`, meilisearch.ts): a bare role query
 * (`isBareRoleQuery`) now issues ONE federated Meilisearch `/multi-search`
 * blending tier 1 (strict title/company/tags, weight 100) and tier 2
 * (whole-document, weight 1) into a single deduplicated pool — precision
 * (tier 1 ranked first) and recall (the union as the pool) are two
 * mechanisms, not one knob. `tier1Total` — the seam a client uses to rank/
 * label tier-1 hits ahead of the mention-only remainder — comes from a
 * PARALLEL limit-0 `runCountPass`, never from the federated response itself
 * (federation reports only the union total, not a per-query sub-total) and
 * never derived from `total` (see jobs-search-body.test.ts's `runCountPass`
 * coverage and /api/jobs/count, which shares the same primitive).
 *
 * These tests pin the RUNTIME federation mechanics this fix depends on:
 * (a) the federated request shape, (b) tier1Total's independent count pass,
 * (c) the headline total is the union not the strict count (I1), (d) facets
 * move to the federation envelope, (e) a different bare-role query than the
 * motivating instance also routes through federation (class-wide, not one
 * phrase), (f) company-scoped/tech-skill queries do NOT take this path at
 * all, (g) filters are identical in both tiers (no special-casing).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
} from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams, PublicJob } from "../../src/lib/jobs/types";

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

async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

type FetchCall = { url: string; body: any };

/** Installs a mock that routes on URL — `/multi-search` for the federated
 *  pass, anything else (the count-pass endpoint) for tier1Total — and
 *  records every call body for inspection. */
function installRoutedMock(opts: {
    federatedHits?: PublicJob[];
    federatedTotal?: number;
    countTotal?: number;
}): FetchCall[] {
    const calls: FetchCall[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url: String(url), body });
        if (String(url).endsWith("/multi-search")) {
            return jsonResponse(200, {
                hits: opts.federatedHits ?? [],
                estimatedTotalHits: opts.federatedTotal ?? (opts.federatedHits?.length ?? 0),
            });
        }
        return jsonResponse(200, { estimatedTotalHits: opts.countTotal ?? 0 });
    });
    return calls;
}

describe("runTieredRetrieval — federated multi-search for bare role queries", () => {
    it("(a) federated request shape: federation.limit/offset, strict query first (weight 100, title/company/tags), whole-document second (weight 1, unscoped), no per-query facets/limit/offset", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        const calls = installRoutedMock({ federatedTotal: 2231, countTotal: 589 });

        await searchMeili({ q, limit: 20, offset: 40 });

        const fed = calls.find((c) => c.url.endsWith("/multi-search"));
        assert.ok(fed, "expected exactly one /multi-search call");
        assert.equal(fed!.body.federation.limit, 20);
        assert.equal(fed!.body.federation.offset, 40);
        assert.equal(fed!.body.queries.length, 2);

        const [strict, whole] = fed!.body.queries;
        assert.deepEqual(strict.attributesToSearchOn, ["title", "company", "tags"]);
        assert.equal(strict.federationOptions.weight, 100);
        assert.equal(strict.indexUid, "jobs");
        assert.ok(!("limit" in strict) && !("offset" in strict) && !("facets" in strict), JSON.stringify(strict));

        assert.ok(!("attributesToSearchOn" in whole), JSON.stringify(whole));
        assert.equal(whole.federationOptions.weight, 1);
        assert.equal(strict.matchingStrategy, "all", "tier 1 requires every word");
        assert.equal(whole.matchingStrategy, "last", "tier 2 relaxes: partial matches rank below full ones, not dropped");
        assert.ok(!("limit" in whole) && !("offset" in whole) && !("facets" in whole), JSON.stringify(whole));
    });

    it("(b) tier1Total comes from a parallel limit-0 count pass — a distinct endpoint from /multi-search", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        const calls = installRoutedMock({ federatedTotal: 2231, countTotal: 589 });

        const result = await searchMeili({ q });

        const countCall = calls.find((c) => !c.url.endsWith("/multi-search"));
        assert.ok(countCall, "expected a distinct count-pass call");
        assert.equal(countCall!.body.limit, 0);
        assert.equal(countCall!.body.offset, 0);
        assert.deepEqual(countCall!.body.attributesToSearchOn, ["title", "company", "tags"], "count pass measures the strict scope");
        assert.equal(result.tier1Total, 589);
    });

    it("(c) headline total is the federated union (estimatedTotalHits), not tier1Total — I1", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        installRoutedMock({ federatedTotal: 2231, countTotal: 589 });

        const result = await searchMeili({ q });

        assert.equal(result.total, 2231, "displayed total is the whole-document union, never the strict-scope count");
        assert.notEqual(result.total, result.tier1Total);
    });

    it("(d) facets are requested only when withFacets is set, placed in federation.facetsByIndex — not per-query", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        let calls = installRoutedMock({ federatedTotal: 10, countTotal: 4 });

        await searchMeili({ q });
        let fed = calls.find((c) => c.url.endsWith("/multi-search"))!;
        assert.ok(!("facetsByIndex" in fed.body.federation), "no facets requested by default");
        assert.ok(!("facets" in fed.body.queries[0]) && !("facets" in fed.body.queries[1]));

        mock.reset();
        calls = installRoutedMock({ federatedTotal: 10, countTotal: 4 });
        await searchMeili({ q, withFacets: true });
        fed = calls.find((c) => c.url.endsWith("/multi-search"))!;
        assert.ok(Array.isArray(fed.body.federation.facetsByIndex.jobs), JSON.stringify(fed.body.federation));
    });

    it("(d2) facetDistribution is read from body.facetsByIndex.jobs.distribution", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        const calls: FetchCall[] = [];
        mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            calls.push({ url: String(url), body });
            if (String(url).endsWith("/multi-search")) {
                return jsonResponse(200, {
                    hits: [],
                    estimatedTotalHits: 10,
                    facetsByIndex: { jobs: { distribution: { location_country: { Canada: 10 } } } },
                });
            }
            return jsonResponse(200, { estimatedTotalHits: 4 });
        });

        const result = await searchMeili({ q, withFacets: true });
        assert.deepEqual(result.facetDistribution, { location_country: { Canada: 10 } });
    });

    it("(e) a different bare-role query (not the motivating instance) also routes through federation — class-wide", async () => {
        const q = "registered nurse";
        await primeNonCompanyIntent(q);
        const calls = installRoutedMock({ federatedTotal: 500, countTotal: 120 });

        const result = await searchMeili({ q });

        assert.ok(calls.some((c) => c.url.endsWith("/multi-search")));
        assert.equal(result.total, 500);
        assert.equal(result.tier1Total, 120);
    });

    it("(f) a company-scoped query never takes the federated path", async () => {
        const q = "cloudflare";
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, {
                hits: Array.from({ length: 5 }, () => ({ company: "Cloudflare", company_domain: "cloudflare.com" })),
                totalHits: 5,
            }),
        );
        await resolveCompanyIntent(q);
        mock.reset();

        const calls = installRoutedMock({ federatedTotal: 999, countTotal: 999 });
        await searchMeili({ q });

        assert.ok(!calls.some((c) => c.url.endsWith("/multi-search")), "company-scoped queries must not federate");
    });

    it("(f2) a tech-skill query never takes the federated path", async () => {
        const q = "Rust";
        await primeNonCompanyIntent(q);
        const calls = installRoutedMock({ federatedTotal: 999, countTotal: 999 });

        await searchMeili({ q });

        assert.ok(!calls.some((c) => c.url.endsWith("/multi-search")), "tech-skill queries must not federate");
    });

    it("(g) filters (board/companyDomain/salary/visa/posted bucket) are identical in both the strict and whole-document tiers", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        const calls = installRoutedMock({ federatedTotal: 10, countTotal: 4 });

        await searchMeili({
            q,
            salaryMin: 100_000,
            visaOnly: true,
            postedBucket: "30d",
            facets: { work_type: ["remote"] },
        });

        const fed = calls.find((c) => c.url.endsWith("/multi-search"))!;
        const [strict, whole] = fed.body.queries;
        assert.deepEqual(strict.filter, whole.filter, "the two tiers must share one filter construction, no special-casing");
        assert.ok(strict.filter.length > 1, "sanity: the scoped filters actually landed in the body");
    });

    it("(i) no unknown-inclusive filter -> still exactly two queries", async () => {
        await primeNonCompanyIntent("registered nurse");
        const calls = installRoutedMock({ federatedTotal: 5, countTotal: 2 });
        await searchMeili({ q: "registered nurse", postedBucket: "30d", visaOnly: true });
        assert.equal(calls.find((c) => c.url.endsWith("/multi-search"))!.body.queries.length, 2);
    });

    const unknownInclusiveCases: [string, Partial<JobSearchParams>][] = [
        ["salary floor", { salaryMin: 120_000 }],
        ["work mode", { facets: { work_type: ["remote"] } }],
    ];
    for (const [label, extra] of unknownInclusiveCases) {
        it(`(j) ${label}: a second query pair carries the unknown rows at half weight, known-only pair leads`, async () => {
            const q = label === "work mode" ? "software engineer" : "registered nurse";
            await primeNonCompanyIntent(q);
            const calls = installRoutedMock({ federatedTotal: 9, countTotal: 3 });
            await searchMeili({ q, ...extra });
            const { queries } = calls.find((c) => c.url.endsWith("/multi-search"))!.body;
            assert.equal(queries.length, 4);
            assert.deepEqual(queries.map((x: any) => x.federationOptions.weight), [100, 1, 50, 0.5]);
            assert.deepEqual(queries.map((x: any) => x.matchingStrategy), ["all", "last", "all", "last"]);
            const unknownMarker = /IS NULL|NOT EXISTS/;
            assert.ok(!unknownMarker.test(queries[0].filter.join()) && !unknownMarker.test(queries[1].filter.join()), "known pair is strict");
            assert.ok(unknownMarker.test(queries[2].filter.join()) && unknownMarker.test(queries[3].filter.join()), "inclusive pair admits unknowns");
            assert.deepEqual(queries[0].attributesToSearchOn, queries[2].attributesToSearchOn);
            assert.ok(!("attributesToSearchOn" in queries[1]) && !("attributesToSearchOn" in queries[3]));
        });
    }

    it("(k) hit tier follows the query's scope across the 4-query layout; total is the federation union", async () => {
        await primeNonCompanyIntent("software engineer");
        const rawHits = [0, 1, 2, 3].map((i) => ({ ...job({ id: `h${i}` }), _federation: { queriesPosition: i } })) as unknown as PublicJob[];
        installRoutedMock({ federatedHits: rawHits, federatedTotal: 4, countTotal: 2 });
        const result = await searchMeili({ q: "software engineer", salaryMin: 100_000 });
        assert.deepEqual(result.hits.map((h) => h.tier), [1, 2, 1, 2]);
        assert.equal(result.total, 4);
    });

    it("(h) each hit carries a `tier` derived from its OWN `_federation.queriesPosition` (0→1, 1→2), and `_federation` is stripped off the wire shape", async () => {
        const q = "software engineer";
        await primeNonCompanyIntent(q);
        const rawHits = [
            { ...job({ id: "strict-1" }), _federation: { queriesPosition: 0 } },
            { ...job({ id: "whole-1" }), _federation: { queriesPosition: 1 } },
            { ...job({ id: "strict-2" }), _federation: { queriesPosition: 0 } },
        ] as unknown as PublicJob[];
        installRoutedMock({ federatedHits: rawHits, federatedTotal: 3, countTotal: 2 });

        const result = await searchMeili({ q });

        assert.deepEqual(
            result.hits.map((h) => [h.id, h.tier]),
            [
                ["strict-1", 1],
                ["whole-1", 2],
                ["strict-2", 1],
            ],
        );
        assert.ok(
            result.hits.every((h) => !("_federation" in h)),
            "the raw federation envelope must not leak onto the outgoing hit",
        );
    });
});
