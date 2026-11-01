/**
 * 2026-11-01, Vivek on a phone in Canada, signed out: "data scientist" showed Country counts of Canada 995,
 * France 3, United States 1, United Kingdom 1. The live search (velai MCP, no IP default) holds 8,958 US
 * data-scientist roles and 538 Canadian ones. The signed-out list is scoped to the visitor's own country
 * (`applyLocationDefault`, ip-default.ts), and the Country counts were taken inside that scope, so every country
 * but the visitor's read as the handful of postings that also list it. Picking "United States 1" listed thousands.
 *
 * The rule (`placeFreeCountQuery` + `withPlaceFreeCountryCounts`, meilisearch.ts): the Country counts come from
 * the same search with no place in it, for any role and any place (IP default, typed place, picked country). Every
 * other filter stays, and every other facet's counts stay those of the list on screen.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
    buildSearchBody,
    placeFreeCountQuery,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
    withPlaceFreeCountryCounts,
} from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams, JobSearchResult, PlaceClause } from "../../src/lib/jobs/types";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    mock.reset();
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

/** The IP default's clause for Canada, as `placeClause(..., { country: true, remoteAnywhere: true })` builds it. */
const CANADA_DEFAULT: PlaceClause = {
    any: [
        { field: "location_country", value: "Canada" },
        { field: "location_country", value: "CA" },
        { field: "location_country", value: "Ontario" },
    ],
    remoteAnywhere: true,
};
const TORONTO: PlaceClause = { any: [{ field: "location_city", value: "Toronto" }] };

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

/** Prod's shape for the report: inside the Canada default the US reads 1; with no place it reads 8,958. */
const SCOPED = {
    location_country: { Canada: 995, Ontario: 40, France: 3, "United States": 1, "United Kingdom": 1 },
    experience_level: { senior: 465, mid: 214 },
    work_type: { remote: 229, hybrid: 300 },
};
const PLACE_FREE = { location_country: { "United States": 8958, India: 2100, Canada: 538, "United Kingdom": 620 } };

/** What the mock reads off a request body: a federated `/multi-search` or a plain `/search`. */
type Query = { q?: string; attributesToSearchOn?: string[]; federationOptions: { weight: number }; filter?: unknown };
type Body = {
    federation: { limit: number; facetsByIndex: { jobs: string[] } };
    queries: Query[];
    q?: string;
    limit?: number;
    filter?: unknown;
    facets?: string[];
};
type Call = { url: string; body: Body };

/** The place-free count query asks for the Country counts alone. */
const isCountQuery = (body: Body) => JSON.stringify(body.federation?.facetsByIndex?.jobs) === JSON.stringify(["location_country"]);

function installFederatedMock(opts: { countDelayMs?: number; countFails?: boolean } = {}): Call[] {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url: String(url), body });
        if (!String(url).endsWith("/multi-search")) return jsonResponse(200, { estimatedTotalHits: 900 });
        if (isCountQuery(body)) {
            if (opts.countFails) return jsonResponse(500, { message: "boom" });
            if (opts.countDelayMs) await new Promise((r) => setTimeout(r, opts.countDelayMs));
            return jsonResponse(200, { hits: [], estimatedTotalHits: 15519, facetsByIndex: { jobs: { distribution: PLACE_FREE } } });
        }
        return jsonResponse(200, { hits: [], estimatedTotalHits: 1229, facetsByIndex: { jobs: { distribution: SCOPED } } });
    });
    return calls;
}

describe("placeFreeCountQuery — which searches get place-free Country counts", () => {
    const listSearch: JobSearchParams = { q: "data scientist", withFacets: true, limit: 20, places: [CANADA_DEFAULT] };

    it("drops every place (IP default, typed, picked) and keeps every other filter", () => {
        const p: JobSearchParams = {
            ...listSearch,
            places: [CANADA_DEFAULT, TORONTO],
            facets: { location_country: ["Canada"], location_city: ["Toronto"], work_type: ["remote"], experience_level: ["senior"] },
            hideGhosts: true,
            postedBucket: "90d",
            salaryMin: 90_000,
        };
        const count = placeFreeCountQuery(p)!;
        assert.equal(count.places, undefined);
        assert.deepEqual(count.facets, { work_type: ["remote"], experience_level: ["senior"] });
        assert.deepEqual(count.facetCountsOnly, ["location_country"]);
        assert.equal(count.q, "data scientist");
        assert.equal(count.hideGhosts, true);
        assert.equal(count.postedBucket, "90d");
        assert.equal(count.salaryMin, 90_000);
        assert.equal(p.places?.length, 2, "the list's own params are not touched");
    });

    it("any country, any role: a picked country alone (no places yet) counts as a place", () => {
        for (const [q, country] of [["registered nurse", "India"], ["accountant", "Germany"], ["", "Brazil"]] as const) {
            const count = placeFreeCountQuery({ q, withFacets: true, limit: 40, facets: { location_country: [country] } });
            assert.ok(count, `${q || "(browse)"} in ${country}`);
            assert.deepEqual(count!.facets, {});
        }
    });

    it("no count query when the search names no place, asks for no facets, lists no rows, or is itself a count", () => {
        assert.equal(placeFreeCountQuery({ q: "data scientist", withFacets: true, limit: 20 }), null, "no place: counts are already place-free");
        assert.equal(placeFreeCountQuery({ ...listSearch, withFacets: false }), null);
        assert.equal(placeFreeCountQuery({ ...listSearch, limit: 1 }), null, "ghost probe (run-search.ts)");
        assert.equal(placeFreeCountQuery({ ...listSearch, limit: 0 }), null, "beyond-window probe (run-search.ts)");
        assert.equal(placeFreeCountQuery({ ...listSearch, facetCountsOnly: ["location_country"] }), null);
        assert.equal(placeFreeCountQuery({ ...listSearch, id: "abc" }), null);
    });

    it("a counts-only body asks for no rows and only the named facets, whatever window a lane set", () => {
        const body = buildSearchBody(
            { q: "director data", withFacets: true, limit: 1000, offset: 80, facetCountsOnly: ["location_country"] },
            false,
        );
        assert.equal(body.limit, 0);
        assert.equal(body.offset, 0);
        assert.deepEqual(body.facets, ["location_country"]);
        const listBody = buildSearchBody({ q: "director data", withFacets: true, limit: 1000, offset: 80 }, false);
        assert.equal(listBody.limit, 1000, "a list search keeps its window");
        assert.ok((listBody.facets ?? []).length > 1);
    });
});

describe("withPlaceFreeCountryCounts", () => {
    const result: JobSearchResult = { hits: [], total: 1229, backend: "meilisearch", configured: true, facetDistribution: SCOPED };

    it("replaces the Country counts only", () => {
        const out = withPlaceFreeCountryCounts(result, PLACE_FREE.location_country);
        assert.deepEqual(out.facetDistribution?.location_country, PLACE_FREE.location_country);
        assert.deepEqual(out.facetDistribution?.experience_level, SCOPED.experience_level);
        assert.deepEqual(out.facetDistribution?.work_type, SCOPED.work_type);
        assert.equal(out.total, 1229, "the list's own total is the list's");
    });

    it("keeps the in-place counts when the count query gave none", () => {
        assert.equal(withPlaceFreeCountryCounts(result, undefined), result);
    });
});

describe("searchMeili — Country counts of a place-scoped search (the reported case)", () => {
    it("the Canada-default 'data scientist' list counts every country the search has roles in", async () => {
        const q = "data scientist";
        await primeNonCompanyIntent(q);
        const calls = installFederatedMock();

        const result = await searchMeili({ q, withFacets: true, limit: 20, places: [CANADA_DEFAULT] });

        assert.equal(result.total, 1229, "the list is still the Canada default's");
        assert.equal(result.facetDistribution?.location_country?.["United States"], 8958);
        assert.equal(result.facetDistribution?.location_country?.Canada, 538);
        assert.deepEqual(result.facetDistribution?.experience_level, SCOPED.experience_level, "other facets count the list on screen");

        const fed = calls.filter((c) => c.url.endsWith("/multi-search"));
        assert.equal(fed.length, 2, "one list search, one count query");
        const list = fed.find((c) => !isCountQuery(c.body))!;
        const count = fed.find((c) => isCountQuery(c.body))!;
        assert.equal(list.body.federation.limit, 20);
        assert.equal(count.body.federation.limit, 1, "the count query reads one row at most");
        assert.ok(JSON.stringify(list.body.queries[0].filter).includes("Canada"), "the list keeps its place");
        for (const query of count.body.queries) {
            const filter = JSON.stringify(query.filter);
            assert.ok(!filter.includes("Canada") && !filter.includes("location_"), `no place in the count query: ${filter}`);
        }
        assert.deepEqual(
            count.body.queries.map((c) => [c.q, c.attributesToSearchOn, c.federationOptions.weight]),
            list.body.queries.map((l) => [l.q, l.attributesToSearchOn, l.federationOptions.weight]),
            "the count query matches the words the same way the list does",
        );
        assert.deepEqual(count.body.federation.facetsByIndex.jobs, ["location_country"]);
        assert.equal(calls.filter((c) => !c.url.endsWith("/multi-search")).length, 1, "the seam count runs for the list only");
    });

    it("a search with no place sends one search, as before", async () => {
        const q = "data scientist";
        await primeNonCompanyIntent(q);
        const calls = installFederatedMock();
        await searchMeili({ q, withFacets: true, limit: 20 });
        assert.equal(calls.filter((c) => c.url.endsWith("/multi-search")).length, 1);
    });

    it("a failed count query leaves the list and its in-place counts as they were", async () => {
        const q = "data scientist";
        await primeNonCompanyIntent(q);
        installFederatedMock({ countFails: true });
        const result = await searchMeili({ q, withFacets: true, limit: 20, places: [CANADA_DEFAULT] });
        assert.equal(result.total, 1229);
        assert.deepEqual(result.facetDistribution?.location_country, SCOPED.location_country);
    });

    it("a count query slower than the grace period never holds the list back", async () => {
        const q = "data scientist";
        await primeNonCompanyIntent(q);
        installFederatedMock({ countDelayMs: 3000 });
        const started = Date.now();
        const result = await searchMeili({ q, withFacets: true, limit: 20, places: [CANADA_DEFAULT] });
        assert.ok(Date.now() - started < 2000, `answered in ${Date.now() - started} ms`);
        assert.deepEqual(result.facetDistribution?.location_country, SCOPED.location_country);
    });

    it("a title-lane search ('director data', a seniority title) counts with no rows in every lane query", async () => {
        const q = "director data";
        await primeNonCompanyIntent(q);
        const calls: Call[] = [];
        mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            calls.push({ url: String(url), body });
            const scoped = JSON.stringify(body.filter ?? "").includes("Canada");
            return jsonResponse(200, {
                hits: [],
                totalHits: 0,
                facetDistribution: body.facets ? (scoped ? SCOPED : PLACE_FREE) : undefined,
            });
        });

        const result = await searchMeili({ q, withFacets: true, limit: 20, places: [CANADA_DEFAULT] });

        assert.equal(result.facetDistribution?.location_country?.["United States"], 8958);
        const countLanes = calls.filter((c) => !JSON.stringify(c.body.filter ?? "").includes("Canada"));
        assert.ok(countLanes.length > 0, "the count query ran");
        for (const c of countLanes) assert.equal(c.body.limit, 0, `count lane "${c.body.q}" asks for no rows`);
        assert.ok(calls.some((c) => JSON.stringify(c.body.filter).includes("Canada") && c.body.limit === 1000), "the list's lanes keep their read");
    });
});

describe("searchJobs — the signed-out path end to end (IP default, query understanding, search)", () => {
    it("a Canadian visitor's 'data scientist' list stays Canada's, and its Country counts are place-free", async () => {
        const { clearSearchCacheForTests } = await import("../../src/lib/jobs/search-cache");
        const { searchJobs } = await import("../../src/lib/jobs/search");
        clearSearchCacheForTests();
        const calls: Call[] = [];
        mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body ?? "{}"));
            calls.push({ url: String(url), body });
            // The IP default checks the corpus holds its country (real bundled gazetteer).
            if (String(url).includes("/facet-search")) return jsonResponse(200, { facetHits: [{ value: body.facetQuery, count: 1000 }] });
            if (String(url).endsWith("/multi-search")) {
                const distribution = isCountQuery(body) ? PLACE_FREE : SCOPED;
                return jsonResponse(200, { hits: [], estimatedTotalHits: isCountQuery(body) ? 15519 : 1229, facetsByIndex: { jobs: { distribution } } });
            }
            return jsonResponse(200, { hits: [], totalHits: 0, estimatedTotalHits: 0 });
        });

        const result = await searchJobs(
            { q: "data scientist", withFacets: true, limit: 20, offset: 0 },
            { clientIp: "1.2.3.4", countryLookup: async () => "CA" },
        );

        assert.equal(result.defaultedLocation, "CA", "the IP default applied");
        assert.equal(result.total, 1229, "the list is the Canada default's");
        assert.equal(result.facetDistribution?.location_country?.["United States"], 8958);
        const fed = calls.filter((c) => c.url.endsWith("/multi-search"));
        assert.ok(fed.some((c) => !isCountQuery(c.body) && JSON.stringify(c.body.queries[0].filter).includes("Canada")));
        assert.ok(fed.some((c) => isCountQuery(c.body) && !JSON.stringify(c.body.queries).includes("Canada")));
    });
});
