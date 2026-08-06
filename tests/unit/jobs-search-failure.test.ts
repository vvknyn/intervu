/**
 * The animana--com incident: a Meilisearch 400 (attribute not filterable)
 * silently collapsed into an empty result, which get-company.ts then read as
 * "this company has zero jobs" and 404'd. These tests pin the class-wide
 * fix at the searchJobs/searchMeili layer — a FAILURE must be distinguishable
 * from a genuine empty result via `unavailable` (see `isUnavailableJobsResult`,
 * lib/jobs/result-state.ts) — using a facet filter, not company_domain, so
 * the coverage doesn't just re-derive the one instance that motivated it.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { isUnavailableJobsResult } from "../../src/lib/jobs/result-state";
import { clearSearchCacheForTests } from "../../src/lib/jobs/search-cache";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    clearSearchCacheForTests();
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

describe("searchJobs / searchMeili — failure vs. empty", () => {
    it("Meili 400 invalid_search_filter (a facet, not company_domain) signals FAILURE, not an empty success", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(400, {
                code: "invalid_search_filter",
                message: "Attribute `experience_level` is not filterable.",
            }),
        );
        const { searchJobs } = await import("../../src/lib/jobs/search");

        const result = await searchJobs({ facets: { experience_level: ["senior"] } });

        assert.equal(isUnavailableJobsResult(result), true, "a 400 must read as unavailable, not empty");
        assert.equal(result.hits.length, 0);
        mock.reset();
    });

    it("Meili 200 with zero hits is a genuine empty success, distinguishable from failure", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        const { searchJobs } = await import("../../src/lib/jobs/search");

        const result = await searchJobs({ facets: { experience_level: ["senior"] } });

        assert.equal(result.hits.length, 0);
        assert.equal(result.total, 0);
        assert.equal(isUnavailableJobsResult(result), false, "a real empty result must not read as unavailable");
        assert.notEqual(result.unavailable, true);
        mock.reset();
    });

    it("a network failure surviving meiliFetch's bounded retry signals FAILURE", async () => {
        mock.method(globalThis, "fetch", async () => {
            throw new Error("ECONNRESET");
        });
        const { searchJobs } = await import("../../src/lib/jobs/search");

        const result = await searchJobs({ facets: { work_type: ["remote"] } });

        assert.equal(isUnavailableJobsResult(result), true, "a persistent network failure must read as unavailable");
        assert.equal(result.hits.length, 0);
        mock.reset();
    });

    it("logs the Meili error code/message at error level for a 4xx config-class response", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(400, {
                code: "invalid_search_facets",
                message: "Attribute `bogus_facet` is not facetable.",
            }),
        );
        const errorCalls: unknown[][] = [];
        mock.method(console, "error", (...args: unknown[]) => {
            errorCalls.push(args);
        });
        const { searchJobs } = await import("../../src/lib/jobs/search");

        await searchJobs({ facets: { experience_level: ["senior"] } });

        const logged = errorCalls.map((args) => args.join(" ")).join("\n");
        assert.match(logged, /invalid_search_facets/, "the raw Meili error code must reach the logs");
        assert.match(logged, /not facetable/, "the raw Meili error message must reach the logs");
        mock.reset();
    });
});
