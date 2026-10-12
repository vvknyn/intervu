/**
 * 2026-10-12: "warehouse" + "Toronto, ON" returned 133 rows, mostly US ones, while
 * "forklift" + Toronto returned ~950 Canadian ones. The index holds "companies"
 * that are really a job-title fragment ("Storekeeper - Warehouse" arrives with
 * company "Warehouse"), so the company-intent probe read "warehouse" as an
 * employer and ran the company-scoped lane ladder, which fetches 100 rows per
 * lane and reported the pooled size as the total.
 *
 * These tests drive `searchMeili` against a mocked index and pin both halves:
 *   1. which queries get company intent (role words never; employers always), and
 *   2. what a company-scoped search returns once it does: the place first and
 *      labelled, a total that is the real match count, and paging past the first
 *      fetch instead of stopping at it.
 * The rows are fictional employers on purpose: nothing here may depend on a
 * particular name; the live names are in company-intent.test fixtures.
 */
import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it, mock } from "node:test";
import {
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntentResult,
    searchMeili,
} from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams, PlaceClause, PublicJob } from "../../src/lib/jobs/types";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

afterEach(() => mock.reset());

const inCanada: PlaceClause = { any: [{ field: "location_country", value: "Canada" }] };

const job = (id: string): PublicJob =>
    ({
        id, title: "Analyst", company: "Acme", company_domain: null, location: null, location_city: null,
        location_state: null, location_country: null, work_type: "onsite", description: null,
        employment_type: "full_time", experience_level: "mid", salary_min: null, salary_max: null,
        salary_currency: null, salary_period: null, visa_sponsorship: null, tags: [],
        apply_url: "https://example.com", source: "test", posted_at: null, first_seen_at: null,
        updated_at: null, vacancy_status: "open", ghost_badge: "unscored",
    }) as PublicJob;
const jobs = (prefix: string, from: number, count: number) =>
    Array.from({ length: count }, (_, i) => job(`${prefix}${from + i}`));

function jsonResponse(body: unknown) {
    const text = JSON.stringify(body);
    const res = { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text), clone: () => res };
    return res;
}

interface MeiliBody {
    q?: string;
    filter?: string[];
    limit?: number;
    offset?: number;
    hitsPerPage?: number;
    attributesToSearchOn?: string[];
    attributesToRetrieve?: string[];
    queries?: MeiliBody[];
}
const isIntentProbe = (b: MeiliBody) => b.hitsPerPage !== undefined && b.attributesToSearchOn?.[0] === "company";
const asSearches = (b: MeiliBody) => b.queries ?? [b];
const hasFilter = (b: MeiliBody, needle: string) => b.filter?.some((f) => f.includes(needle)) ?? false;
const excludedIds = (b: MeiliBody): string[] => {
    const clause = b.filter?.find((f) => f.startsWith("NOT id IN "));
    return clause ? (JSON.parse(clause.slice("NOT id IN ".length)) as string[]) : [];
};

/** Installs a fetch mock; returns every body it saw, in order. */
function mockIndex(handler: (body: MeiliBody) => unknown): MeiliBody[] {
    const seen: MeiliBody[] = [];
    mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as MeiliBody;
        seen.push(body);
        return jsonResponse(handler(body));
    });
    return seen;
}

/** What the company-field probe returns for `company`: ten rows named exactly that, with these titles. */
const probeRows = (company: string, domain: string, titleFor: (i: number) => string) => ({
    hits: Array.from({ length: 10 }, (_, i) => ({ company, company_domain: domain, title: titleFor(i) })),
    totalHits: 80,
});

describe("company intent comes from the index's own evidence, not from a list of names", () => {
    it("role words the index also carries as junk 'companies' are title searches", async () => {
        for (const word of ["warehouse", "mechanic", "production", "plumber"]) {
            resetCompanyIntentCacheForTests();
            const seen = mockIndex(() =>
                probeRows(word[0].toUpperCase() + word.slice(1), "", (i) => `Operator ${i} - ${word[0].toUpperCase()}${word.slice(1)}`),
            );
            const intent = await resolveCompanyIntentResult(word);
            assert.equal(intent.companyScoped, false, word);
            assert.ok(seen[0].attributesToRetrieve?.includes("title"), "the probe has to ask for titles to have evidence");
            mock.reset();
        }
    });

    it("role words that no company is named after are title searches", async () => {
        for (const word of ["nurse", "driver", "cashier", "teacher", "welder"]) {
            resetCompanyIntentCacheForTests();
            mockIndex(() => ({ hits: [], totalHits: 0 }));
            assert.equal((await resolveCompanyIntentResult(word)).companyScoped, false, word);
            mock.reset();
        }
    });

    it("employers keep it, one word or several, even when a few of their titles carry their name", async () => {
        for (const [name, domain] of [["Globex", "globex.com"], ["Initech Systems", "initech.com"], ["Umbrella Health Group", "umbrella.example"]]) {
            resetCompanyIntentCacheForTests();
            // 3 of 10 titles repeat the name (a product line, a team): well under the echo limit.
            mockIndex(() => probeRows(name, domain, (i) => (i < 3 ? `${name} Account Lead` : "Senior Analyst")));
            const intent = await resolveCompanyIntentResult(name.toLowerCase());
            assert.deepEqual(intent, { companyScoped: true, companyDomains: [domain] }, name);
            mock.reset();
        }
    });
});

describe("a role word with a place is a plain title search with its true total", () => {
    it("is not company-scoped, not capped at one fetch, and not marked as an employer search", async () => {
        for (const word of ["warehouse", "mechanic", "production"]) {
            resetCompanyIntentCacheForTests();
            const Word = word[0].toUpperCase() + word.slice(1);
            const seen = mockIndex((b) =>
                isIntentProbe(b)
                    ? probeRows(Word, "", () => `Storekeeper - ${Word}`)
                    : { hits: jobs("t", 1, 40), totalHits: 2852, estimatedTotalHits: 2852 },
            );
            const result = await searchMeili({ q: word, places: [inCanada], limit: 40, offset: 0 });
            assert.equal(result.total, 2852, word);
            assert.equal(result.inPlace, undefined, word);
            const searches = seen.filter((b) => !isIntentProbe(b)).flatMap(asSearches);
            assert.ok(searches.length > 0);
            for (const s of searches) {
                assert.notDeepEqual(s.attributesToSearchOn, ["company"], `${word}: no company scoping on any request`);
                assert.equal(hasFilter(s, "company_domain"), false, word);
                assert.equal(hasFilter(s, "NOT id IN"), false, word);
            }
            mock.reset();
        }
    });
});

describe("an explicit company pin always scopes the results", () => {
    it("pins the company on every request even though the query text is a role word", async () => {
        const Word = "Warehouse";
        const seen = mockIndex((b) =>
            isIntentProbe(b)
                ? probeRows(Word, "", () => `Storekeeper - ${Word}`)
                : { hits: jobs("a", 1, 10), totalHits: 10, estimatedTotalHits: 10 },
        );
        const result = await searchMeili({ q: "warehouse", companyDomain: "globex.com", places: [inCanada], limit: 40, offset: 0 });
        assert.equal(result.total, 10);
        const searches = seen.filter((b) => !isIntentProbe(b)).flatMap(asSearches);
        assert.ok(searches.length > 0);
        for (const s of searches) assert.ok(hasFilter(s, 'company_domain = "globex.com"'), JSON.stringify(s.filter));
    });

    it("keeps a pinned employer search scoped to that employer's rows", async () => {
        const seen = mockIndex((b) =>
            isIntentProbe(b)
                ? probeRows("Globex", "globex.com", () => "Senior Analyst")
                : { hits: jobs("a", 1, 3), totalHits: 3 },
        );
        await searchMeili({ q: "globex", companyDomain: "globex.com", places: [inCanada], limit: 40, offset: 0 });
        const lanes = seen.filter((b) => !isIntentProbe(b));
        assert.ok(lanes.length > 0);
        for (const l of lanes) {
            assert.deepEqual(l.attributesToSearchOn, ["company"]);
            assert.ok(hasFilter(l, 'company_domain = "globex.com"'));
        }
    });
});

const globex = (): JobSearchParams => ({ q: "globex", places: [inCanada], limit: 40, offset: 0 });

/**
 * An employer with 340 rows in the place (and 1000 in all): the place lane holds
 * 100 of them, the rows after those are only reachable through the tail request.
 */
function mockBigPlace() {
    return mockIndex((b) => {
        if (isIntentProbe(b)) return probeRows("Globex", "globex.com", () => "Senior Analyst");
        const inPlace = hasFilter(b, "location_country");
        if (!inPlace) return { hits: jobs("e", 1, 100), totalHits: 1000 };
        if (excludedIds(b).length === 0) return { hits: jobs("p", 1, 100), totalHits: 340 };
        return { hits: jobs("t", (b.offset ?? 0) + 1, b.limit ?? 0), totalHits: 240 };
    });
}

describe("a company search whose place holds more rows than one fetch pages on through them", () => {
    it("reports the true total, and the place as the whole list", async () => {
        const seen = mockBigPlace();
        const result = await searchMeili(globex());
        assert.equal(result.total, 340, "the place's real match count, not the 100 rows fetched");
        assert.equal(result.inPlace, 340);
        assert.equal(result.hits.length, 40);
        assert.ok(result.hits.every((h) => h.id.startsWith("p")), "rows from elsewhere do not intermix");
        assert.equal(seen.filter((b) => excludedIds(b).length > 0).length, 0, "page one needs no tail request");
    });

    it("serves a page past the first fetch from the same lane, without repeating a row", async () => {
        const seen = mockBigPlace();
        const first = await searchMeili({ ...globex(), offset: 0, limit: 100 });
        const pooled = first.hits.map((h) => h.id);
        const beyond = await searchMeili({ ...globex(), offset: 100, limit: 40 });

        assert.equal(beyond.total, 340);
        assert.equal(beyond.hits.length, 40);
        assert.equal(beyond.hits.filter((h) => pooled.includes(h.id)).length, 0, "no row from the first fetch comes back");
        const tailRequest = seen.filter((b) => excludedIds(b).length > 0).at(-1)!;
        assert.deepEqual(new Set(excludedIds(tailRequest)), new Set(pooled), "the tail excludes exactly the pooled rows");
        assert.ok(hasFilter(tailRequest, "location_country"), "and stays in the place");
        assert.ok(hasFilter(tailRequest, 'company_domain = "globex.com"'), "and stays on the employer");
        assert.equal(tailRequest.offset, 0);
        assert.equal(tailRequest.limit, 40);
    });

    it("fills a page that straddles the edge of the first fetch from both sides", async () => {
        mockBigPlace();
        const page = await searchMeili({ ...globex(), offset: 80, limit: 40 });
        assert.equal(page.hits.length, 40);
        assert.equal(new Set(page.hits.map((h) => h.id)).size, 40, "no duplicates across the seam");
        assert.equal(page.hits.filter((h) => h.id.startsWith("t")).length, 20);
    });
});

describe("a company search whose place has few rows still shows the rest of the employer, labelled", () => {
    /** Initech has 2 rows in the place and 500 in all; Hooli has none in the place and 12 in all. */
    function mockEmployer(name: string, domain: string, inPlaceRows: number, allRows: number) {
        return mockIndex((b) => {
            if (isIntentProbe(b)) return probeRows(name, domain, () => "Senior Analyst");
            const placeLane = hasFilter(b, "location_country");
            const base = [...jobs("i", 1, inPlaceRows), ...jobs("x", 1, Math.min(allRows, 100) - inPlaceRows)];
            if (excludedIds(b).length > 0) return { hits: jobs("t", (b.offset ?? 0) + 1, b.limit ?? 0), totalHits: allRows - base.length };
            return placeLane
                ? { hits: base.slice(0, inPlaceRows), totalHits: inPlaceRows }
                : { hits: base, totalHits: allRows };
        });
    }

    it("puts the rows in the place first, however the ranking would order them", async () => {
        mockEmployer("Initech", "initech.com", 2, 500);
        const result = await searchMeili({ q: "initech", places: [inCanada], limit: 40, offset: 0 });
        assert.deepEqual(new Set(result.hits.slice(0, 2).map((h) => h.id)), new Set(["i1", "i2"]));
        assert.equal(result.inPlace, 2);
        assert.equal(result.total, 500, "the employer's real count, not the pool's size");
    });

    it("pages past the pool for the rows from elsewhere too", async () => {
        const seen = mockEmployer("Initech", "initech.com", 2, 500);
        const result = await searchMeili({ q: "initech", places: [inCanada], limit: 40, offset: 100 });
        assert.equal(result.total, 500);
        assert.equal(result.hits.length, 40);
        assert.equal(excludedIds(seen.filter((b) => excludedIds(b).length > 0).at(-1)!).length, 100);
    });

    it("says so when the employer has nothing at all in the place", async () => {
        mockEmployer("Hooli", "hooli.com", 0, 12);
        const result = await searchMeili({ q: "hooli", places: [inCanada], limit: 40, offset: 0 });
        assert.equal(result.inPlace, 0);
        assert.equal(result.total, 12);
        assert.equal(result.hits.length, 12);
    });

    it("makes no in-place claim when no place was asked for", async () => {
        mockEmployer("Initech", "initech.com", 0, 12);
        const result = await searchMeili({ q: "initech", facets: { work_type: ["remote"] }, limit: 40, offset: 0 });
        assert.equal(result.inPlace, undefined);
    });
});
