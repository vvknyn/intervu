/**
 * Vivek, 2026-11-08: "searching product manager integral ad science should search for product manager jobs in that
 * company if it exists...if not, show integral ad science jobs followed by product manager jobs". These drive
 * `searchMeili` and `fetchJobSuggestions` against a mocked index and pin the wiring end to end: which searches are
 * sent, pinned to what, and in what order their rows come back. The pure rules are in employer-role.test.ts,
 * jobs-company-intent.test.ts and jobs-suggestions.test.ts. The employers are fictional on purpose.
 */
import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it, mock } from "node:test";
import {
    fetchJobSuggestions,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
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

afterEach(() => mock.reset());

const EMPLOYER = { name: "Northwind Ad Labs", domain: "northwind-adlabs.example" };

const job = (id: string, title: string, company: string, domain: string | null): PublicJob =>
    ({
        id, title, company, company_domain: domain, location: null, location_city: null, location_state: null,
        location_country: null, work_type: "onsite", description: null, employment_type: "full_time",
        experience_level: "mid", salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
        visa_sponsorship: null, tags: [], apply_url: "https://example.com", source: "test", posted_at: null,
        first_seen_at: null, updated_at: null, vacancy_status: "open", ghost_badge: "unscored",
    }) as PublicJob;

interface MeiliBody {
    q?: string;
    facets?: string[];
    filter?: string[];
    limit?: number;
    offset?: number;
    hitsPerPage?: number;
    distinct?: string;
    matchingStrategy?: string;
    attributesToSearchOn?: string[];
    queries?: MeiliBody[];
    federation?: unknown;
}

const pinned = (b: MeiliBody) => b.filter?.some((f) => f.includes(`company_domain = "${EMPLOYER.domain}"`)) ?? false;
const isCompanyNameSearch = (b: MeiliBody) => b.attributesToSearchOn?.length === 1 && b.attributesToSearchOn[0] === "company";

function jsonResponse(body: unknown) {
    const text = JSON.stringify(body);
    const res = { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text), clone: () => res };
    return res;
}

const BOARD = "jobboard.example";

/**
 * The index: `employerRows` are the employer's roles, `roleAtEmployer` the ones of them a role search finds,
 * `elsewhere` that role at other employers. The employer-name search knows the employer when `known` (dominant,
 * 10 rows), or by two rows when `few`: one on its own domain and one on a job board that also lists other employers.
 */
function mockIndex(opts: {
    known: boolean;
    few?: boolean;
    roleAtEmployer: PublicJob[];
    employerRows: PublicJob[];
    elsewhere: PublicJob[];
    wholeText?: PublicJob[];
}) {
    const seen: MeiliBody[] = [];
    const answer = (b: MeiliBody): { hits: PublicJob[] | object[]; totalHits: number; facetDistribution?: object } => {
        if (b.facets?.includes("company_domain")) {
            // Per domain: rows carrying the employer's name, and rows in all. The board carries one of fifty.
            const named = { [EMPLOYER.domain]: 2, [BOARD]: 1 };
            const all = { [EMPLOYER.domain]: 2, [BOARD]: 50 };
            return { hits: [], totalHits: 0, facetDistribution: { company_domain: b.attributesToSearchOn ? named : all } };
        }
        if (isCompanyNameSearch(b)) {
            const named = (opts.known || opts.few) && /northwind ad labs/i.test(b.q ?? "");
            const own = (i: number) => ({ company: EMPLOYER.name, company_domain: EMPLOYER.domain, title: `Role ${i}` });
            const rows = !named
                ? []
                : opts.few
                  ? [{ company: EMPLOYER.name, company_domain: BOARD, title: "Role on a board" }, own(0)]
                  : Array.from({ length: 10 }, (_, i) => own(i));
            return { hits: rows, totalHits: rows.length ? (opts.few ? 2 : 40) : 0 };
        }
        const q = (b.q ?? "").toLowerCase();
        const page = (rows: PublicJob[]) => ({ hits: rows.slice(b.offset ?? 0, (b.offset ?? 0) + (b.limit ?? b.hitsPerPage ?? 40)), totalHits: rows.length });
        if (pinned(b)) return page(q.trim() ? opts.roleAtEmployer : opts.employerRows);
        if (/northwind/.test(q)) return page(opts.wholeText ?? []);
        if (/product manager/.test(q) || /product|manager/.test(q)) return page(opts.elsewhere);
        return page([]);
    };
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as MeiliBody;
        seen.push(body);
        if (!String(url).includes("multi-search")) return jsonResponse(answer(body));
        const results = (body.queries ?? []).map(answer);
        if (body.federation) {
            // A federated search returns each document once, from the first query that found it.
            const ids = new Set<string>();
            const hits = results.flatMap((r, i) =>
                (r.hits as PublicJob[]).flatMap((h) => (ids.has(h.id) ? [] : (ids.add(h.id), [{ ...h, _federation: { queriesPosition: i } }]))),
            );
            return jsonResponse({ hits, estimatedTotalHits: ids.size });
        }
        return jsonResponse({ results: results.map((r) => ({ ...r, estimatedTotalHits: r.totalHits })) });
    });
    return seen;
}

const searchesOf = (seen: MeiliBody[]) => seen.flatMap((b) => b.queries ?? [b]).filter((b) => !isCompanyNameSearch(b));

describe("a role + employer query", () => {
    it("searches the role at the employer when it has the role, and says how it read the words", async () => {
        const roleAtEmployer = [job("pm-1", "Senior Product Manager", EMPLOYER.name, EMPLOYER.domain)];
        const seen = mockIndex({ known: true, roleAtEmployer, employerRows: [], elsewhere: [] });
        const result = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["pm-1"]);
        assert.equal(result.effectiveQ, "product manager");
        assert.deepEqual(result.employer, {
            domains: [EMPLOYER.domain],
            name: EMPLOYER.name,
            role: "product manager",
            source: "typed",
            roleMatches: 1,
        });
        const searches = searchesOf(seen);
        assert.ok(searches.length > 0);
        for (const s of searches) {
            assert.ok(pinned(s), `every search is pinned to the employer: ${JSON.stringify(s.filter)}`);
            assert.doesNotMatch(s.q ?? "", /northwind/i, "the employer's name is not searched as text");
        }
    });

    it("with none of the role at the employer, lists its other roles first, then the role at other employers", async () => {
        const employerRows = [job("own-1", "Account Executive", EMPLOYER.name, EMPLOYER.domain), job("own-2", "Data Analyst", EMPLOYER.name, EMPLOYER.domain)];
        const elsewhere = [job("else-1", "Product Manager", "Contoso", "contoso.example"), job("else-2", "Product Manager II", "Fabrikam", "fabrikam.example")];
        mockIndex({ known: true, roleAtEmployer: [], employerRows, elsewhere });
        const result = await searchMeili({ q: "northwind ad labs product manager", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["own-1", "own-2", "else-1", "else-2"]);
        assert.equal(result.total, 4);
        assert.equal(result.employer?.roleMatches, 0);
        assert.equal(result.employer?.employerRoles, 2);
        assert.equal(result.employer?.name, EMPLOYER.name);
    });

    it("the employer chosen as the filter, with the role typed, gets the same list (the follow-up to a typed read)", async () => {
        const employerRows = [job("own-1", "Account Executive", EMPLOYER.name, EMPLOYER.domain)];
        const elsewhere = [job("else-1", "Product Manager", "Contoso", "contoso.example")];
        mockIndex({ known: false, roleAtEmployer: [], employerRows, elsewhere });
        const result = await searchMeili({ q: "product manager", companyDomain: EMPLOYER.domain, limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["own-1", "else-1"]);
        assert.equal(result.employer?.source, "chosen");
        assert.equal(result.employer?.name, EMPLOYER.name, "named from its own rows");
    });

    it("with no employer of that name in the index and nothing matching every word, searches the role and names the words left out", async () => {
        const elsewhere = [job("else-1", "Product Manager", "Contoso", "contoso.example")];
        mockIndex({ known: false, roleAtEmployer: [], employerRows: [], elsewhere, wholeText: [] });
        const result = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["else-1"]);
        assert.equal(result.effectiveQ, "product manager");
        assert.deepEqual(result.unmatchedQueryMentions, ["northwind ad labs"]);
        assert.equal(result.employer, undefined);
    });

    it("with no employer of that name and rows that only mention the words, lists the role and names the words left out", async () => {
        // Release 74's live check: 79 rows held every word somewhere, none was the role, and the page listed them.
        const elsewhere = [job("else-1", "Product Manager", "Contoso", "contoso.example")];
        const wholeText = [job("noise-1", "Senior Data Scientist", "Fabrikam Bank", "fabrikam.example"), job("noise-2", "Software Test Engineer", "Contoso", "contoso.example")];
        mockIndex({ known: false, roleAtEmployer: [], employerRows: [], elsewhere, wholeText });
        const result = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["else-1"]);
        assert.equal(result.effectiveQ, "product manager");
        assert.deepEqual(result.unmatchedQueryMentions, ["northwind ad labs"]);
        // A later page of the same list gets the same answer.
        const page2 = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 40 });
        assert.deepEqual(page2.unmatchedQueryMentions, ["northwind ad labs"]);
    });

    it("an employer with a few roles, below the floor, is read as the employer, on its own domain and never on a board's", async () => {
        const employerRows = [job("own-1", "Account Executive", EMPLOYER.name, EMPLOYER.domain)];
        const elsewhere = [job("else-1", "Product Manager", "Contoso", "contoso.example")];
        const wholeText = [job("noise-1", "Senior Data Scientist", "Fabrikam Bank", "fabrikam.example")];
        const seen = mockIndex({ known: false, few: true, roleAtEmployer: [], employerRows, elsewhere, wholeText });
        const result = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["own-1", "else-1"]);
        assert.deepEqual(result.employer?.domains, [EMPLOYER.domain]);
        assert.equal(result.employer?.source, "typed");
        assert.equal(result.employer?.roleMatches, 0);
        assert.equal(result.unmatchedQueryMentions, undefined);
        const boardPins = searchesOf(seen).filter((b) => b.filter?.some((f) => f.includes(BOARD) && !b.facets));
        assert.deepEqual(boardPins, [], "no list search is pinned to the board");
    });

    it("with no employer of that name but rows that hold every word, lists those rows as found", async () => {
        const wholeText = [job("mention-1", "Product Manager, Ad Measurement", "Contoso", "contoso.example")];
        mockIndex({ known: false, roleAtEmployer: [], employerRows: [], elsewhere: [], wholeText });
        const result = await searchMeili({ q: "product manager northwind ad labs", limit: 40, offset: 0 });
        assert.deepEqual(result.hits.map((h) => h.id), ["mention-1"]);
        assert.equal(result.unmatchedQueryMentions, undefined);
    });
});

describe("the search box's Companies section", () => {
    it("lists the employer the words name, first, from the employer-name search, with its domain", async () => {
        const seen = mockIndex({ known: true, roleAtEmployer: [], employerRows: [], elsewhere: [] });
        const suggestions = await fetchJobSuggestions("northwind ad labs");
        assert.deepEqual(suggestions.employers, [{ name: EMPLOYER.name, domain: EMPLOYER.domain }]);
        assert.equal(suggestions.employersFirst, true);
        const employerSearch = seen.find((b) => isCompanyNameSearch(b) && b.distinct === "company_domain");
        assert.ok(employerSearch, "one search reads the employer names, one row per employer");
    });

    it("reads role + employer words as the role at that employer", async () => {
        mockIndex({ known: true, roleAtEmployer: [], employerRows: [], elsewhere: [] });
        const suggestions = await fetchJobSuggestions("product manager northwind ad labs");
        assert.deepEqual(suggestions.employers, [{ name: EMPLOYER.name, domain: EMPLOYER.domain, role: "product manager" }]);
        assert.equal(suggestions.employersFirst, true);
    });

    it("lists an employer once, on its own domain, when a job board also carries a row under its name", async () => {
        mockIndex({ known: false, few: true, roleAtEmployer: [], employerRows: [], elsewhere: [] });
        const suggestions = await fetchJobSuggestions("northwind ad labs");
        assert.deepEqual(suggestions.employers, [{ name: EMPLOYER.name, domain: EMPLOYER.domain }]);
    });

    it("lists no employer when no employer's name holds the words", async () => {
        mockIndex({ known: false, roleAtEmployer: [], employerRows: [], elsewhere: [] });
        const suggestions = await fetchJobSuggestions("integral");
        assert.equal(suggestions.employers, undefined);
        assert.equal(suggestions.employersFirst, undefined);
    });
});
