/**
 * The roles next to a typed title, used by fit and by type-ahead (Vivek, 2026-11-01: "used intelligently to
 * appropriately adjust the search results...and also use the same logic for autosuggest or type ahead too").
 *
 *  - A Best match first page (`relatedPreview`) also reads the related roles' first rows, appended after its own and
 *    marked, outside the paging and the total (`runTieredRetrieval`).
 *  - A list ranked by fit keeps such a row only when it fits as Strong or Good (`keepsRelatedRow`).
 *  - Type-ahead suggests related roles from the same table, only titles postings use (`relatedSuggestions`).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
    RELATED_PREVIEW_LIMIT,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
} from "../../src/lib/jobs/meilisearch";
import { keepsRelatedRow } from "../../src/lib/jobs/related-rows";
import { relatedSuggestions, type TitleNeighbourTable } from "../../src/lib/jobs/title-neighbours";
import { MATCH_BAND_GOOD_MIN, MATCH_BAND_STRONG_MIN, type MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

const job = (id: string, title: string, extra: Partial<PublicJob> = {}): PublicJob =>
    ({
        id,
        title,
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
        ...extra,
    }) as PublicJob;

function jsonResponse(status: number, body: unknown) {
    const text = JSON.stringify(body);
    const res = { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), clone: () => res };
    return res;
}

type Call = { url: string; body: any };

/** The page's own federated search answers `paged`; the related preview (only tier-3 queries, its own limit) answers `preview`. */
function installMock(paged: Array<PublicJob & { _federation: { queriesPosition: number } }>, preview: Array<PublicJob & { _federation: { queriesPosition: number } }>): Call[] {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url: String(url), body });
        if (String(url).endsWith("/multi-search")) {
            const isPreview = body.federation.limit === RELATED_PREVIEW_LIMIT && !body.federation.facetsByIndex;
            return jsonResponse(200, isPreview ? { hits: preview } : { hits: paged, estimatedTotalHits: 924 });
        }
        return jsonResponse(200, { estimatedTotalHits: 924 });
    });
    return calls;
}

async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

const Q = "technical account manager";

describe("a Best match first page reads the related roles' first rows too", () => {
    it("appends the related rows the page does not hold, marked, outside the total; names their titles", async () => {
        await primeNonCompanyIntent(Q);
        const tam = job("a", "Technical Account Manager");
        const calls = installMock([{ ...tam, _federation: { queriesPosition: 0 } }], [
            { ...job("b", "Customer Success Manager"), _federation: { queriesPosition: 0 } },
            { ...tam, _federation: { queriesPosition: 1 } },
        ]);
        const result = await searchMeili({ q: Q, limit: 300, offset: 0, withFacets: true, fromResume: true, relatedPreview: true });
        mock.reset();

        const multi = calls.filter((c) => c.url.endsWith("/multi-search"));
        assert.equal(multi.length, 2, "the page's search and the preview");
        const preview = multi.find((c) => c.body.federation.limit === RELATED_PREVIEW_LIMIT)!;
        const page = multi.find((c) => c !== preview)!;
        // The preview asks only the page's related-role queries, title-scoped.
        assert.equal(preview.body.queries.length, page.body.queries.filter((q: any) => q.federationOptions.weight <= 3 && q.federationOptions.weight > 1).length);
        assert.ok(preview.body.queries.every((q: any) => JSON.stringify(q.attributesToSearchOn) === JSON.stringify(["title"])), JSON.stringify(preview.body.queries.map((q: any) => q.attributesToSearchOn)));

        assert.deepEqual(result.hits.map((h) => [h.id, h.tier, h.relatedPreview ?? null]), [["a", 1, null], ["b", 3, true]]);
        assert.equal(result.total, 924, "the preview rows are not part of the search's total");
        assert.ok(result.relatedTitles && result.relatedTitles.length > 0, "the related titles the rows came from are named");
    });

    it("reads no preview past the first page, or when the list is not Best match", async () => {
        await primeNonCompanyIntent(Q);
        const calls = installMock([{ ...job("a", "Technical Account Manager"), _federation: { queriesPosition: 0 } }], []);
        await searchMeili({ q: Q, limit: 40, offset: 300, fromResume: true, relatedPreview: true });
        await searchMeili({ q: Q, limit: 20, offset: 0 });
        mock.reset();
        assert.equal(calls.filter((c) => c.url.endsWith("/multi-search")).length, 2, "one federated search each, no preview");
    });
});

describe("a list ranked by fit keeps a related row only when it fits as Strong or Good", () => {
    const score = (total: number) => ({ total }) as MatchScore;
    const preview = job("p", "Customer Success Manager", { tier: 3, relatedPreview: true });
    it("keeps Strong and Good, drops Stretch and unscored", () => {
        assert.equal(keepsRelatedRow(preview, score(MATCH_BAND_STRONG_MIN)), true);
        assert.equal(keepsRelatedRow(preview, score(MATCH_BAND_GOOD_MIN)), true);
        assert.equal(keepsRelatedRow(preview, score(MATCH_BAND_GOOD_MIN - 1)), false);
        assert.equal(keepsRelatedRow(preview, null), false);
    });
    it("never drops a row the search itself found, whatever its fit", () => {
        assert.equal(keepsRelatedRow(job("t", "Technical Account Manager", { tier: 1 }), score(10)), true);
        assert.equal(keepsRelatedRow(job("r", "Customer Success Manager", { tier: 3 }), null), true);
    });
});

describe("type-ahead suggests related roles from the same table", () => {
    const table: TitleNeighbourTable = {
        generatedAt: "2026-11-01",
        titles: {
            "technical account manager": ["Account Manager", "Diet Cook", "Customer Success Manager", "Technical Advisor", "Solutions Engineer"],
            "sous chef": ["Grill Cook", "Diet Cook"],
        },
        postingTitles: ["account manager", "customer success manager", "technical advisor", "solutions engineer", "technical account manager"],
    };
    it("lists what is typed's related roles that postings use, at most 3, without a title already suggested", () => {
        assert.deepEqual(relatedSuggestions("technical account manager", ["Technical Account Manager", "Account Manager"], 3, table), ["Customer Success Manager", "Technical Advisor", "Solutions Engineer"]);
    });
    it("while the typed words are not yet a title, uses the first title suggested for them", () => {
        assert.deepEqual(relatedSuggestions("technical acc", ["Technical Account Manager"], 2, table), ["Account Manager", "Customer Success Manager"]);
    });
    it("suggests nothing rather than a title no posting uses", () => {
        assert.deepEqual(relatedSuggestions("sous chef", ["Sous Chef"], 3, table), []);
        assert.deepEqual(relatedSuggestions("xyz", [], 3, table), []);
    });
});
