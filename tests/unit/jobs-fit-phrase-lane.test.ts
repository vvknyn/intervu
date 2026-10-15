import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { formatQuotedOrQuery } from "../../src/lib/jobs/fit-phrases";
import {
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    interleaveFitPhraseLanes,
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

describe("fit-phrase lanes share each page", () => {
    const lane = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => job({ id: `${prefix}${i}`, title: prefix }));

    it("gives four phrases about 4, 3, 2 and 1 of every 10 rows, strongest phrase first", () => {
        const out = interleaveFitPhraseLanes([lane("a", 30), lane("b", 30), lane("c", 30), lane("d", 30)]);
        const first10 = out.slice(0, 10).map((h) => h.title);
        assert.equal(out[0].id, "a0");
        assert.deepEqual(
            ["a", "b", "c", "d"].map((p) => first10.filter((t) => t === p).length),
            [4, 3, 2, 1],
            first10.join(""),
        );
        assert.equal(out.length, 120);
    });

    it("keeps each lane's own order, lists a row two lanes found once, and gives an empty lane's share to the rest", () => {
        const shared = job({ id: "shared", title: "a" });
        const out = interleaveFitPhraseLanes([[shared, ...lane("a", 3)], [], [shared, ...lane("c", 3)]]);
        assert.deepEqual(out.map((h) => h.id).filter((id) => id.startsWith("a")), ["a0", "a1", "a2"]);
        assert.equal(out.filter((h) => h.id === "shared").length, 1);
        assert.equal(out.length, 7);
    });

    it("a résumé pack searching Product Manager first still gets its Customer Success roles on the first page", async () => {
        const phrases = ["Product Manager", "Customer Success Manager", "Technical Account Manager", "Technical Product Manager"];
        const q = formatQuotedOrQuery(phrases);
        await primeNonCompanyIntent(q);
        const byPhrase: Record<string, PublicJob[]> = {
            "product manager": lane("Product Manager ", 200).map((h, i) => ({ ...h, title: "Product Manager", id: `pm${i}` })),
            "customer success manager": lane("csm", 50).map((h, i) => ({ ...h, title: "Customer Success Manager", id: `csm${i}` })),
            "technical account manager": lane("tam", 20).map((h, i) => ({ ...h, title: "Technical Account Manager", id: `tam${i}` })),
            "technical product manager": lane("tpm", 20).map((h, i) => ({ ...h, title: "Technical Product Manager", id: `tpm${i}` })),
        };
        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                const hits = byPhrase[String(body.q ?? "").toLowerCase()] ?? [];
                return jsonResponse(200, { hits, totalHits: hits.length });
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });
        const result = await searchMeili({ q, sort: "relevance", limit: 60, offset: 0 });
        mock.reset();
        const count = (title: string) => result.hits.filter((h) => h.title === title).length;
        assert.equal(result.hits.length, 60);
        assert.ok(count("Customer Success Manager") >= 15, `CSM rows: ${count("Customer Success Manager")}`);
        assert.ok(count("Technical Account Manager") >= 10, `TAM rows: ${count("Technical Account Manager")}`);
        assert.ok(count("Product Manager") >= 20, `PM rows: ${count("Product Manager")}`);
        assert.equal(result.total, 290);
    });

    it("omitPastSenior leaves staff, principal, director and executive rows out of the pool so the page fills with the rest", async () => {
        const q = '"Product Manager" OR "Technical Account Manager"';
        await primeNonCompanyIntent(q);
        const rows = [
            job({ id: "pm-staff", title: "Staff Product Manager", experience_level: "lead" }),
            job({ id: "pm-principal", title: "Principal Product Manager", experience_level: "senior" }),
            job({ id: "pm-director", title: "Director, Product Manager Enablement", experience_level: "senior" }),
            job({ id: "pm-exec", title: "Product Manager", experience_level: "executive" }),
            job({ id: "pm-senior", title: "Senior Product Manager", experience_level: "senior" }),
            job({ id: "pm-lead", title: "Lead Product Manager", experience_level: "lead" }),
            job({ id: "pm-plain", title: "Product Manager", experience_level: "mid" }),
            job({ id: "tam-staff", title: "Staff Technical Account Manager", experience_level: "senior" }),
            job({ id: "tam-plain", title: "Technical Account Manager", experience_level: "unknown" }),
        ];
        const respond = () =>
            mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input).includes("/indexes/jobs/search") && init?.method === "POST") {
                    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                    const hits = /technical account manager/i.test(String(body.q)) ? rows.filter((r) => /tam-/.test(r.id)) : rows.filter((r) => /pm-/.test(r.id));
                    return jsonResponse(200, { hits, totalHits: hits.length });
                }
                return jsonResponse(200, { hits: [], totalHits: 0 });
            });

        respond();
        const kept = await searchMeili({ q, sort: "relevance", omitPastSenior: true, limit: 50, offset: 0 });
        mock.reset();
        assert.deepEqual([...kept.hits.map((h) => h.id)].sort(), ["pm-lead", "pm-plain", "pm-senior", "tam-plain"]);
        assert.equal(kept.total, 4, "the count is of what the list can show");

        await primeNonCompanyIntent(q);
        respond();
        const all = await searchMeili({ q, sort: "relevance", limit: 50, offset: 0 });
        mock.reset();
        assert.equal(all.hits.length, rows.length, "without the flag the search is unchanged");
    });

    it("a typed search still finds a Staff role: a lane whose own phrase asks for one keeps its rows, and a single typed phrase is never trimmed", async () => {
        const rows = [
            job({ id: "pm-staff", title: "Staff Product Manager", experience_level: "lead" }),
            job({ id: "pm-director", title: "Director of Product", experience_level: "senior" }),
            job({ id: "pm-plain", title: "Product Manager", experience_level: "mid" }),
        ];
        const respond = () =>
            mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input).endsWith("/multi-search")) return jsonResponse(200, { hits: rows, estimatedTotalHits: rows.length });
                if (String(input).includes("/indexes/jobs/search") && init?.method === "POST") {
                    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
                    const hits = /staff/i.test(String(body.q)) ? rows.filter((r) => /staff/i.test(r.title)) : rows;
                    return jsonResponse(200, { hits, totalHits: hits.length });
                }
                return jsonResponse(200, { hits: [], totalHits: 0 });
            });

        const two = '"Staff Product Manager" OR "Product Manager"';
        await primeNonCompanyIntent(two);
        respond();
        const typedTwo = await searchMeili({ q: two, sort: "relevance", fromResume: true, omitPastSenior: true, limit: 50, offset: 0 });
        mock.reset();
        assert.ok(typedTwo.hits.some((h) => h.id === "pm-staff"), "the Staff phrase the person typed still returns Staff rows");
        assert.ok(!typedTwo.hits.some((h) => h.id === "pm-director"), "the résumé's other phrase still leaves past-Senior rows out");

        const one = "Staff Product Manager";
        await primeNonCompanyIntent(one);
        respond();
        const typedOne = await searchMeili({ q: one, sort: "relevance", fromResume: true, omitPastSenior: true, limit: 50, offset: 0 });
        mock.reset();
        assert.ok(typedOne.hits.some((h) => h.id === "pm-staff"), "a single typed phrase is not a fit-phrase lane, so nothing is trimmed");
    });
});
