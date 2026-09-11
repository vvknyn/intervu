/**
 * Sep 9 2026 fix: "product manager" on Freshest surfaced "Assistant Store
 * Manager" (Eg Otm) — matchingStrategy "all" only requires each word to
 * match SOMEWHERE in the document, so "manager" matched the title and
 * "product" matched the description ("…product information…"). Best match's
 * relevance ranking hid this; a date sort has nothing to hide behind it.
 *
 * Fix: `buildSearchBody`'s `titleFirstScoped` branch (now behind the
 * `isBareRoleQuery` predicate — see jobs-search-body.test.ts for the pure-
 * function coverage) scopes a bare role query to title/company/tags under
 * EVERY sort — company/tech-skill/role-title-lane queries are untouched.
 *
 * Sep 10 2026 (this PR): root-caused as a SECOND, separate defect — the
 * title-scoped pass was the ONLY pass for a bare role query, so genuine
 * whole-document matches (title says "Engineer II", description says
 * "software engineer") were dropped from the pool entirely, not merely
 * ranked behind. The single-pass "expand only when title-scoped comes back
 * EMPTY" fallback these tests used to pin is gone: a bare role query now
 * always issues tier 1 (strict title/company/tags, weight 100) and tier 2
 * (whole-document, weight 1) TOGETHER as one federated `/multi-search`, so
 * the deduplicated union is always the pool regardless of how many tier-1
 * hits exist — never gated on a zero-hit miss. These tests pin the RUNTIME
 * half of that: the exact federated request shape, and that the strict pass
 * (`queries[0]`) keeps the title/company/tags scoping this defect fix
 * depends on.
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

/** Pre-warms the company-intent cache so the probe fired for any non-empty q
 *  doesn't add noise to the mock installed after this resolves — same
 *  pattern as jobs-sort-set-invariance.test.ts. */
async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

describe("bare-role-query tiered retrieval (runTieredRetrieval)", () => {
    it("issues one federated /multi-search (strict + whole-document) plus one parallel strict count pass — never a sequential re-issue", async () => {
        const q = "registered nurse";
        await primeNonCompanyIntent(q);

        const multiSearchBodies: { queries: { attributesToSearchOn?: string[]; federationOptions?: { weight: number } }[] }[] = [];
        const countBodies: { attributesToSearchOn?: string[] }[] = [];
        let multiSearchCalls = 0;
        let countCalls = 0;
        mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            if (String(url).endsWith("/multi-search")) {
                multiSearchCalls++;
                multiSearchBodies.push(body);
                return jsonResponse(200, {
                    hits: [job({ id: "a", title: "Registered Nurse" })],
                    estimatedTotalHits: 1,
                });
            }
            countCalls++;
            countBodies.push(body);
            return jsonResponse(200, { estimatedTotalHits: 1 });
        });

        const result = await searchMeili({ q });

        assert.equal(multiSearchCalls, 1, "exactly one federated request — no zero-hit re-issue mechanism on this path");
        assert.equal(countCalls, 1, "exactly one parallel strict count pass for tier1Total");
        assert.deepEqual(
            multiSearchBodies[0].queries[0].attributesToSearchOn,
            ["title", "company", "tags"],
            "tier 1 (queries[0]) stays title/company/tags-scoped",
        );
        assert.equal(multiSearchBodies[0].queries[0].federationOptions?.weight, 100);
        assert.ok(
            !("attributesToSearchOn" in multiSearchBodies[0].queries[1]),
            `tier 2 (queries[1]) must be whole-document: ${JSON.stringify(multiSearchBodies[0].queries[1])}`,
        );
        assert.equal(multiSearchBodies[0].queries[1].federationOptions?.weight, 1);
        assert.deepEqual(countBodies[0].attributesToSearchOn, ["title", "company", "tags"], "tier1Total counts the strict scope only");
        assert.equal(result.hits.length, 1);
        assert.equal(result.tier1Total, 1);
    });

    it("a non-empty strict tier still issues the same federated pair — the whole-document tier is never conditional on tier-1 hit count", async () => {
        const q = "product manager";
        await primeNonCompanyIntent(q);

        let multiSearchCalls = 0;
        let countCalls = 0;
        const multiSearchBodies: { queries: { attributesToSearchOn?: string[] }[] }[] = [];
        mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
            if (String(url).endsWith("/multi-search")) {
                multiSearchCalls++;
                multiSearchBodies.push(JSON.parse(String(init.body)));
                return jsonResponse(200, {
                    hits: [job({ id: "a", title: "Product Manager" })],
                    estimatedTotalHits: 1,
                });
            }
            countCalls++;
            return jsonResponse(200, { estimatedTotalHits: 1 });
        });

        const result = await searchMeili({ q });

        assert.equal(multiSearchCalls, 1, "one federated request regardless of tier-1 hit count");
        assert.equal(countCalls, 1);
        assert.deepEqual(multiSearchBodies[0].queries[0].attributesToSearchOn, ["title", "company", "tags"]);
        assert.equal(result.hits.length, 1);
    });
});
