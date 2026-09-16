import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { formatQuotedOrQuery } from "../../src/lib/jobs/fit-phrases";
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

async function primeNonCompanyIntent(q: string) {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
    await resolveCompanyIntent(q);
    mock.reset();
}

type SearchCall = { url: string; body: Record<string, unknown> };

describe("searchMeili fit-phrase lane", () => {
    it('fires separate searches per quoted-OR phrase and unions hits', async () => {
        const q = '"Product Manager" OR "Software Engineer"';
        await primeNonCompanyIntent(q);

        const pmHit = job({ id: "pm", title: "Product Manager" });
        const sweHit = job({ id: "swe", title: "Software Engineer" });
        const calls: SearchCall[] = [];

        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                calls.push({ url, body });
                const phrase = String(body.q ?? "");
                if (/product manager/i.test(phrase)) {
                    return jsonResponse(200, { hits: [pmHit], totalHits: 1 });
                }
                if (/software engineer/i.test(phrase)) {
                    return jsonResponse(200, { hits: [sweHit], totalHits: 1 });
                }
                return jsonResponse(200, { hits: [], totalHits: 0 });
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });

        const result = await searchMeili({ q, sort: "relevance" });

        const indexSearches = calls.filter((c) => c.url.includes("/indexes/jobs/search"));
        assert.ok(indexSearches.length >= 2, "expected separate index searches per phrase");
        assert.ok(
            indexSearches.some((c) => /product manager/i.test(String(c.body.q))),
            "expected a Product Manager sub-query",
        );
        assert.ok(
            indexSearches.some((c) => /software engineer/i.test(String(c.body.q))),
            "expected a Software Engineer sub-query",
        );
        for (const c of indexSearches) {
            assert.equal(c.body.matchingStrategy, "all");
        }

        const ids = new Set(result.hits.map((h) => h.id));
        assert.ok(ids.has("pm"), "PM-only hit must appear from union");
        assert.ok(ids.has("swe"), "SWE-only hit must appear from union");
    });

    it("uses fitPhrases param with the same union behavior", async () => {
        await primeNonCompanyIntent("Product Manager");

        const pmHit = job({ id: "pm", title: "Product Manager" });
        const sweHit = job({ id: "swe", title: "Software Engineer" });
        const phraseQs: string[] = [];

        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                phraseQs.push(String(body.q ?? ""));
                if (/product manager/i.test(String(body.q))) {
                    return jsonResponse(200, { hits: [pmHit], totalHits: 1 });
                }
                if (/software engineer/i.test(String(body.q))) {
                    return jsonResponse(200, { hits: [sweHit], totalHits: 1 });
                }
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });

        const result = await searchMeili({
            q: "Product Manager",
            fitPhrases: ["Product Manager", "Software Engineer"],
        });

        assert.ok(phraseQs.some((pq) => /product manager/i.test(pq)));
        assert.ok(phraseQs.some((pq) => /software engineer/i.test(pq)));
        const ids = new Set(result.hits.map((h) => h.id));
        assert.ok(ids.has("pm"));
        assert.ok(ids.has("swe"));
    });

    it('does not treat unquoted "Director OR Manager" as fit-phrase lane', async () => {
        const q = "Director OR Manager";
        await primeNonCompanyIntent(q);

        const phraseQs: string[] = [];
        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                phraseQs.push(String(body.q ?? ""));
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });

        await searchMeili({ q, sort: "relevance" });

        const fitLanePair = phraseQs.filter((pq) => pq === "Director" || pq === "Manager");
        assert.equal(
            fitLanePair.length,
            0,
            `unquoted OR must not spawn parallel fit-phrase searches, got: ${phraseQs.join(" | ")}`,
        );
    });

    it("retrieves PM-only hit from Okta-shaped quoted-OR query", async () => {
        const q = formatQuotedOrQuery([
            "Product Manager",
            "Technical Product Manager",
            "Software Engineer",
            "Backend Engineer",
        ]);
        await primeNonCompanyIntent(q);

        const pmHit = job({ id: "pm-only", title: "Product Manager" });

        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                const phrase = String(body.q ?? "");
                if (/product manager/i.test(phrase) && !/technical|software|backend/i.test(phrase)) {
                    return jsonResponse(200, { hits: [pmHit], totalHits: 1 });
                }
                return jsonResponse(200, { hits: [], totalHits: 0 });
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });

        const result = await searchMeili({ q, sort: "relevance" });
        assert.ok(result.hits.some((h) => h.id === "pm-only"), "PM lane hit should surface in union");
    });
});
