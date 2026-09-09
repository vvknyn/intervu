/**
 * Sep 9 2026 fix: "product manager" on Freshest surfaced "Assistant Store
 * Manager" (Eg Otm) — matchingStrategy "all" only requires each word to
 * match SOMEWHERE in the document, so "manager" matched the title and
 * "product" matched the description ("…product information…"). Best match's
 * relevance ranking hid this; a date sort has nothing to hide behind it.
 *
 * Fix: `buildSearchBody`'s new `titleFirstScoped` branch scopes a bare role
 * query to title/company/tags under EVERY sort (see jobs-search-body.test.ts
 * for the pure-function coverage) — company/tech-skill/role-title-lane
 * queries are untouched. These tests pin the RUNTIME half: the empty-pool
 * fallback in `runSearch` that keeps a genuinely thin query from going
 * empty. It's the same two-tier strict/expand retrieval
 * (`shouldRelaxSearch`/`mergeExpandedIntoStrict`) `techSkillScoped` already
 * relies on — `titleFirstScoped` participates by being gated on
 * `!wholeDocument`, so no separate fallback mechanism was added.
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

describe("title-first scope empty-pool fallback (runSearch)", () => {
    it("a zero-hit title-scoped pass falls back to exactly one whole-document re-issue", async () => {
        const q = "registered nurse";
        await primeNonCompanyIntent(q);

        const bodies: { attributesToSearchOn?: string[] }[] = [];
        let calls = 0;
        mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
            calls++;
            const body = JSON.parse(String(init.body)) as { attributesToSearchOn?: string[] };
            bodies.push(body);
            return calls === 1
                ? jsonResponse(200, { hits: [], totalHits: 0 })
                : jsonResponse(200, { hits: [job({ id: "a", title: "Registered Nurse" })], totalHits: 1 });
        });

        const result = await searchMeili({ q });

        assert.equal(calls, 2, "one title-scoped pass + one whole-document re-issue");
        assert.deepEqual(bodies[0].attributesToSearchOn, ["title", "company", "tags"], "first call is title-scoped");
        assert.ok(!("attributesToSearchOn" in bodies[1]), `second call must be whole-document: ${JSON.stringify(bodies[1])}`);
        assert.equal(result.hits.length, 1);
    });

    it("a non-empty title-scoped result makes exactly one call — no fallback fires", async () => {
        const q = "product manager";
        await primeNonCompanyIntent(q);

        let calls = 0;
        const bodies: { attributesToSearchOn?: string[] }[] = [];
        mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
            calls++;
            bodies.push(JSON.parse(String(init.body)));
            return jsonResponse(200, { hits: [job({ id: "a", title: "Product Manager" })], totalHits: 1 });
        });

        const result = await searchMeili({ q });

        assert.equal(calls, 1, "non-empty title-scoped pass — no whole-document fallback");
        assert.deepEqual(bodies[0].attributesToSearchOn, ["title", "company", "tags"]);
        assert.equal(result.hits.length, 1);
    });
});
