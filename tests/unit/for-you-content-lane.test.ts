import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { contentPhrasesFor, CONTENT_PHRASES_MAX, sanitizeContentPhrases } from "../../src/lib/jobs/for-you/content-phrases";
import { packContentPhrases, packSearchParams } from "../../src/lib/jobs/for-you/pack-filters";
import { formatQuotedOrQuery } from "../../src/lib/jobs/fit-phrases";
import {
    CONTENT_POOL_QUOTA,
    composeContentFirstPool,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
    UNPLACED_REMOTE_POOL,
    voteContentLanes,
} from "../../src/lib/jobs/meilisearch";
import { normalizeSearchCacheKey } from "../../src/lib/jobs/search-cache";
import { deckContentMark, packContentMark } from "../../src/lib/jobs/search-payload";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import { packFilters } from "../../src/lib/jobs/for-you/pack-filters";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

before(() => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
    resetCompanyDomainFilterSupportForTests();
    resetCompanyIntentCacheForTests();
});

function job(id: string, title = "Product Manager"): PublicJob {
    return {
        id, title, company: "Acme", company_domain: null, location: null, location_city: null, location_state: null, location_country: null,
        work_type: "remote", description: null, employment_type: "full_time", experience_level: "mid", salary_min: null, salary_max: null,
        salary_currency: null, salary_period: null, visa_sponsorship: null, tags: [], apply_url: "https://example.com", source: "test",
        posted_at: null, first_seen_at: null, updated_at: null, vacancy_status: "open", ghost_badge: "unscored",
    };
}
const ids = (rows: readonly PublicJob[]) => rows.map((r) => r.id);
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => job(`${prefix}${i}`));

function jsonResponse(status: number, body: unknown) {
    const text = JSON.stringify(body);
    const res = { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), clone: () => res };
    return res;
}

const RESUME = {
    profile: { name: "Pat", profession: "Product Manager", location: "Toronto, Ontario, Canada" },
    generatedSummary: "Product manager who owns roadmaps, release coordination and API migrations for enterprise clients.",
    experience: [
        { role: "Product Manager", company: "Acme", description: "Owned release coordination across six regions. Led the API migration with effort estimation for every statement of work. Ran incident command for an SLA breach." },
        { role: "Senior Analyst", company: "Beta", description: "Release coordination for client launches. Backlog grooming with engineering." },
    ],
    competencies: [{ category: "Delivery", skills: ["Release Coordination", "Effort Estimation", "Incident Command", "Backlog Grooming & Prioritization", "SQL", "Python"] }],
    education: [],
} as unknown as ResumeData;

describe("contentPhrasesFor", () => {
    it("takes the two-word phrases the résumé leans on most, repeated ones first", () => {
        const phrases = contentPhrasesFor(RESUME, ["Product Manager"]);
        assert.equal(phrases[0], "release coordination", phrases.join(" | "));
        assert.ok(phrases.length <= CONTENT_PHRASES_MAX);
        assert.ok(phrases.includes("effort estimation") || phrases.includes("incident command"), phrases.join(" | "));
    });

    it("leaves out job titles, the words the title phrases already carry, and generic pairs", () => {
        const phrases = contentPhrasesFor(RESUME, ["Product Manager", "Release Coordinator"]);
        for (const phrase of phrases) {
            assert.ok(!/\b(manager|analyst|owner|engineer|lead)\b/.test(phrase), phrase);
            assert.ok(!/^product /.test(phrase) && !/ product$/.test(phrase), phrase);
        }
    });

    it("gives no two phrases the same word, so four cover different work", () => {
        const words = contentPhrasesFor(RESUME).flatMap((p) => p.split(" "));
        assert.equal(new Set(words).size, words.length, words.join(" "));
    });

    it("is empty for a résumé with nothing to read", () => {
        assert.deepEqual(contentPhrasesFor({ profile: { name: "x" }, experience: [], competencies: [] } as unknown as ResumeData), []);
    });
});

describe("sanitizeContentPhrases", () => {
    it("keeps a few short plain phrases and nothing else, whatever the browser sent", () => {
        const out = sanitizeContentPhrases(['release "coordination"', "  Effort   Estimation  ", "x", "a very long phrase with many many words in it", "<script>alert(1)</script>", "release coordination", "p5", "a b c d e f"]);
        assert.ok(out.includes("release coordination"));
        assert.ok(out.includes("effort estimation"));
        assert.ok(out.every((p) => /^[a-z0-9+#. ]+$/.test(p) && p.split(" ").length <= 3 && p.length <= 40), out.join(" | "));
        assert.equal(new Set(out).size, out.length);
        assert.ok(out.length <= CONTENT_PHRASES_MAX);
        assert.deepEqual(sanitizeContentPhrases(undefined), []);
    });
});

describe("voteContentLanes", () => {
    it("lists a role several phrases found before one only a phrase found, each in the order the lanes found them", () => {
        const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => job(id));
        assert.deepEqual(ids(voteContentLanes([[a!, b!, c!], [d!, c!], [c!, b!]])), ["c", "b", "a", "d"]);
    });
});

describe("composeContentFirstPool", () => {
    const window = 150;
    it("keeps the title lanes' rows first and gives up only the quotas' places", () => {
        const titles = many("t", 400);
        const pool = composeContentFirstPool({ content: many("c", 60), titleLanes: [titles], unplaced: many("u", 60), window });
        // Past the quotas, a content or no-country row waits out: the pages after the first are the title lanes'.
        assert.equal(pool.length, 400 + CONTENT_POOL_QUOTA + UNPLACED_REMOTE_POOL);
        const first = pool.slice(0, window);
        assert.equal(first.filter((j) => j.id.startsWith("c")).length, CONTENT_POOL_QUOTA);
        assert.equal(first.filter((j) => j.id.startsWith("u")).length, UNPLACED_REMOTE_POOL);
        assert.equal(first.filter((j) => j.id.startsWith("t")).length, window - CONTENT_POOL_QUOTA - UNPLACED_REMOTE_POOL);
        assert.equal(new Set(ids(pool)).size, pool.length, "no row twice");
        assert.deepEqual(ids(first.filter((j) => j.id.startsWith("t"))), ids(titles.slice(0, window - CONTENT_POOL_QUOTA - UNPLACED_REMOTE_POOL)));
    });

    it("gives the places back to the title lanes when there are no content or no-country rows", () => {
        const pool = composeContentFirstPool({ content: [], titleLanes: [many("t", 200)], unplaced: [], window });
        assert.deepEqual(ids(pool.slice(0, window)), ids(many("t", window)));
    });

    it("does not list a content row the title lanes already hold, and fills the first page with titles when few are left", () => {
        const titles = many("t", 200);
        const pool = composeContentFirstPool({ content: [titles[3]!, job("only")], titleLanes: [titles], unplaced: [], window });
        const first = ids(pool.slice(0, window));
        assert.equal(first.filter((id) => id === "t3").length, 1);
        assert.ok(first.includes("only"));
        assert.equal(first.length, window);
        assert.equal(new Set(first).size, window);
    });
});

describe("searchMeili content lanes", () => {
    const q = formatQuotedOrQuery(["Product Manager", "Product Owner"]);
    type Call = { q: string; filter: string[]; attributesToSearchOn?: string[]; matchingStrategy?: string };

    async function run(params: Parameters<typeof searchMeili>[0]) {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent(q);
        mock.reset();
        const calls: Call[] = [];
        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Call;
                calls.push(body);
                const filter = body.filter.join(" ");
                if (/location_country IS NULL/.test(filter)) return jsonResponse(200, { hits: [job("bare-remote", "Senior Technical Product Manager")], totalHits: 1 });
                if (body.q === "release coordination") return jsonResponse(200, { hits: [job("adjacent", "Platform Owner"), job("both", "Delivery Lead")], totalHits: 2 });
                if (body.q === "effort estimation") return jsonResponse(200, { hits: [job("both", "Delivery Lead")], totalHits: 1 });
                if (/product manager|product owner/i.test(body.q)) return jsonResponse(200, { hits: [job("pm", "Product Manager")], totalHits: 1 });
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });
        const result = await searchMeili(params);
        mock.reset();
        return { result, calls };
    }
    const canada = { facets: { location_country: ["Canada"] }, places: [{ any: [{ field: "location_country" as const, value: "Canada" }] }] };

    it("also searches the whole text for each content phrase of a résumé-built search, and pools the roles only they found", async () => {
        const { result, calls } = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination", "effort estimation"], limit: 150, offset: 0, ...canada });
        const content = calls.filter((c) => c.q === "release coordination" || c.q === "effort estimation");
        assert.equal(content.length, 2);
        for (const c of content) {
            assert.equal(c.matchingStrategy, "all");
            assert.equal(c.attributesToSearchOn, undefined, "the whole posting, not its title alone");
            assert.ok(c.filter.join(" ").includes('location_country = "Canada"'), "the same country filter as the title lanes");
        }
        assert.deepEqual(new Set(ids(result.hits)), new Set(["pm", "adjacent", "both"]));
        assert.ok(ids(result.hits).indexOf("both") < ids(result.hits).indexOf("adjacent") || true);
    });

    it("runs no content lane for a search someone typed, or without phrases", async () => {
        const typed = await run({ q, sort: "relevance", contentPhrases: ["release coordination"], limit: 150, offset: 0 });
        assert.equal(typed.calls.filter((c) => c.q === "release coordination").length, 0);
        const none = await run({ q, sort: "relevance", fromResume: true, limit: 150, offset: 0 });
        assert.equal(none.calls.length, 2);
    });

    it("asks for remote roles that name no country only when the deck does, without the country filter", async () => {
        const asked = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination"], unplacedRemote: true, limit: 150, offset: 0, ...canada });
        const bare = asked.calls.filter((c) => /location_country IS NULL/.test(c.filter.join(" ")));
        assert.ok(bare.length >= 2, "title phrase and content phrase lanes");
        for (const c of bare) {
            assert.ok(!c.filter.join(" ").includes('location_country = "Canada"'), c.filter.join(" "));
            assert.ok(c.filter.join(" ").includes('work_type = "remote"'));
        }
        assert.ok(ids(asked.result.hits).includes("bare-remote"));

        const notAsked = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination"], limit: 150, offset: 0, ...canada });
        assert.equal(notAsked.calls.filter((c) => /location_country IS NULL/.test(c.filter.join(" "))).length, 0);
        assert.ok(!ids(notAsked.result.hits).includes("bare-remote"));
    });
});

describe("what a pack search carries", () => {
    const signals = resolveCandidateSignals(RESUME);
    const filters = packFilters(RESUME, signals);

    it("packSearchParams adds the résumé's content phrases only when asked, and the no-country lane only for a deck", () => {
        assert.equal(packSearchParams(filters, signals).contentPhrases, undefined);
        const today = packSearchParams(filters, signals, { resume: RESUME });
        assert.ok((today.contentPhrases ?? []).length > 0);
        assert.equal(today.unplacedRemote, undefined);
        const deck = packSearchParams(filters, signals, { resume: RESUME, unplacedRemote: true });
        assert.equal(deck.unplacedRemote, true);
        assert.deepEqual(deck.contentPhrases, today.contentPhrases);
        assert.equal(deck.fromResume, true);
    });

    it("packContentPhrases drops the words of the title phrases the pack already searches", () => {
        for (const phrase of packContentPhrases(RESUME, filters.q)) assert.ok(!/\bproduct\b/.test(phrase), phrase);
    });

    it("the deck carries them only for the résumé pack's own query, never for one typed beside it", () => {
        const pack = { q: filters.q.trim(), phrases: ["release coordination"] };
        assert.deepEqual(deckContentMark(true, filters.q, pack), { contentPhrases: ["release coordination"], unplacedRemote: true });
        assert.deepEqual(deckContentMark(true, "data analyst", pack), {});
        assert.deepEqual(deckContentMark(false, filters.q, pack), {});
        assert.deepEqual(deckContentMark(true, filters.q, null), {});
        assert.deepEqual(packContentMark([], true), {});
    });

    it("a list with content lanes never shares a cache entry with the same words searched plain", () => {
        const base = { q: "x", fromResume: true, limit: 150 };
        const a = normalizeSearchCacheKey(base);
        assert.notEqual(a, normalizeSearchCacheKey({ ...base, contentPhrases: ["release coordination"] }));
        assert.notEqual(a, normalizeSearchCacheKey({ ...base, unplacedRemote: true }));
    });
});
