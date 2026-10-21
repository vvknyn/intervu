import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { contentPairsFor, contentPhrasesFor, contentWordsFor, CONTENT_LANES_MAX, CONTENT_PHRASES_MAX, CONTENT_WORDS_MAX, sanitizeContentPhrases } from "../../src/lib/jobs/for-you/content-phrases";
import { FOR_YOU_READ_DEPTH, packContentPhrases, packSearchParams } from "../../src/lib/jobs/for-you/pack-filters";
import { formatQuotedOrQuery } from "../../src/lib/jobs/fit-phrases";
import {
    CONTENT_LANE_LIMIT,
    CONTENT_SINGLE_LANE_POOL,
    composeContentFirstPool,
    FOR_YOU_POOL_WINDOW,
    resetCompanyDomainFilterSupportForTests,
    resetCompanyIntentCacheForTests,
    resolveCompanyIntent,
    searchMeili,
    TITLE_POOL_FLOOR,
    UNPLACED_REMOTE_POOL,
    voteContentLanes,
} from "../../src/lib/jobs/meilisearch";
import { normalizeSearchCacheKey } from "../../src/lib/jobs/search-cache";
import { resumeContentMark, packContentMark } from "../../src/lib/jobs/search-payload";
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

describe("contentPairsFor", () => {
    it("takes the two-word phrases the résumé leans on most, repeated ones first", () => {
        const phrases = contentPairsFor(RESUME, ["Product Manager"]);
        assert.equal(phrases[0], "release coordination", phrases.join(" | "));
        assert.ok(phrases.length <= CONTENT_PHRASES_MAX);
        assert.ok(phrases.includes("effort estimation") || phrases.includes("incident command"), phrases.join(" | "));
    });

    it("leaves out job titles, the words the title phrases already carry, and generic pairs", () => {
        const phrases = contentPairsFor(RESUME, ["Product Manager", "Release Coordinator"]);
        for (const phrase of phrases) {
            assert.ok(!/\b(manager|analyst|owner|engineer|lead)\b/.test(phrase), phrase);
            assert.ok(!/^product /.test(phrase) && !/ product$/.test(phrase), phrase);
        }
    });

    it("gives no two phrases the same word, so four cover different work", () => {
        const words = contentPairsFor(RESUME).flatMap((p) => p.split(" "));
        assert.equal(new Set(words).size, words.length, words.join(" "));
    });

    it("bridges two-word & or / skills ('Audit & Tax') without bridging multi-word clauses into cross-boundary pairs", () => {
        const acct = {
            profile: { name: "Alex", profession: "Accountant" },
            generatedSummary: "Accountant owning audit and tax filings and user research.",
            experience: [{ role: "Accountant", company: "Firm", description: "Led audit and tax preparation and user research." }],
            competencies: [{ category: "Core", skills: ["Audit & Tax", "Product Discovery & User Research"] }],
            education: [],
        } as unknown as ResumeData;
        const pairs = contentPairsFor(acct, ["Accountant", "Product Manager"]);
        assert.ok(pairs.includes("audit tax"), pairs.join(" | "));
        assert.ok(pairs.includes("user research"), pairs.join(" | "));
        assert.ok(!pairs.includes("discovery user"), pairs.join(" | "));
    });
});

describe("contentWordsFor", () => {
    const withSkills = (skills: string[], extra: Partial<ResumeData> = {}) =>
        ({ profile: { name: "Pat Rivera" }, experience: [], competencies: [{ category: "Skills", skills }], ...extra }) as unknown as ResumeData;

    it("takes single words from the skills the résumé lists, the longest (rarest) first, at most CONTENT_WORDS_MAX", () => {
        const words = contentWordsFor(withSkills(["Meilisearch", "Observability & Alerting", "n8n Workflow Automation", "Jira", "Postgres"]));
        assert.equal(words.length, CONTENT_WORDS_MAX);
        assert.deepEqual(words, ["observability", "meilisearch", "automation"]);
    });

    it("reads tools and short domain words, not the words of a phrase already chosen, the title, a broad or generic word, a job noun, or the person's name", () => {
        const words = contentWordsFor(
            withSkills(["Release Coordination", "SQL", "Product Management", "Rivera", "Data Analysis", "Team Lead", "Pat", "FHIR HL7", "Strategy"]),
            ["Product Manager"],
            ["release coordination"],
        );
        assert.deepEqual(words.sort(), ["fhir", "hl7", "sql"]);
    });

    it("never reads the prose: a word the experience lines say but the skills list does not stays in the résumé", () => {
        const resume = withSkills(["Python"], { generatedSummary: "Worked with Tracxn and Zophop on kubernetes migrations.", experience: [{ role: "PM", company: "Tracxn", description: "Used kubernetes with Zophop." }] as never });
        assert.deepEqual(contentWordsFor(resume), ["python"]);
    });

    it("is empty for a résumé listing no skills, and the lanes put the duty phrases before the words", () => {
        assert.deepEqual(contentWordsFor({ profile: { name: "x" }, experience: [], competencies: [] } as unknown as ResumeData), []);
        const lanes = contentPhrasesFor(RESUME, ["Product Manager"]);
        assert.ok(lanes.length <= CONTENT_LANES_MAX);
        const firstWord = lanes.findIndex((p) => !p.includes(" "));
        assert.ok(firstWord === -1 || lanes.slice(0, firstWord).every((p) => p.includes(" ")), lanes.join(" | "));
        assert.ok(lanes.slice(firstWord).every((p) => !p.includes(" ")), lanes.join(" | "));
    });
});

describe("contentPhrasesFor", () => {
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
        assert.ok(out.length <= CONTENT_LANES_MAX);
        assert.deepEqual(sanitizeContentPhrases(undefined), []);
    });

    it("takes single words (a tool, a domain) as lanes too, at most CONTENT_WORDS_MAX of them and CONTENT_PHRASES_MAX phrases", () => {
        const out = sanitizeContentPhrases(["python", "n8n", "x", "sql", "postgres", "release coordination", "effort estimation", "incident command", "backlog grooming", "api migration"]);
        assert.deepEqual(out.filter((p) => !p.includes(" ")), ["python", "n8n", "sql"]);
        assert.equal(out.filter((p) => p.includes(" ")).length, CONTENT_PHRASES_MAX);
    });
});

describe("voteContentLanes", () => {
    it("lists a role several phrases found before one only a phrase found, each in the order the lanes found them", () => {
        const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => job(id));
        const { strong, weak } = voteContentLanes([[a!, b!, c!], [d!, c!], [c!, b!]]);
        assert.deepEqual(ids(strong), ["c", "b"], "found by two lanes or more");
        assert.deepEqual(ids(weak), ["a", "d"], "found by one lane");
    });

    it("places a role only one lane found by where that lane put it, so the first lane's long list does not crowd the others out", () => {
        const first = many("a", 30);
        const second = many("b", 30);
        const third = many("c", 30);
        const { strong, weak } = voteContentLanes([first, second, third]);
        // rank 1 of every lane, then rank 2 of every lane...
        assert.deepEqual(ids(weak).slice(0, 6), ["a0", "b0", "c0", "a1", "b1", "c1"]);
        assert.equal(weak.length, 90);
        assert.equal(strong.length, 0);
    });
});

describe("composeContentFirstPool", () => {
    const window = FOR_YOU_POOL_WINDOW;
    const contentPlaces = window - UNPLACED_REMOTE_POOL - TITLE_POOL_FLOOR;
    const first = (pool: PublicJob[], prefix: string) => pool.slice(0, window).filter((j) => j.id.startsWith(prefix));

    it("pool of 150: content lanes claim 90 places first, title lanes fill the other 40, roles with no country take 20 last", () => {
        assert.equal(contentPlaces, 90);
        const content = many("c", 200);
        const titles = many("t", 400);
        const pool = composeContentFirstPool({ content, titleLanes: [titles], unplaced: many("u", 60), window });
        assert.equal(first(pool, "c").length, 90);
        assert.equal(first(pool, "t").length, TITLE_POOL_FLOOR);
        assert.equal(first(pool, "u").length, UNPLACED_REMOTE_POOL);
        assert.deepEqual(ids(pool.slice(0, 90)), ids(content.slice(0, 90)), "content leads, in its voted order");
        assert.deepEqual(ids(first(pool, "t")), ids(titles.slice(0, TITLE_POOL_FLOOR)), "the title lanes fill in their own order");
        assert.deepEqual(ids(pool.slice(window - UNPLACED_REMOTE_POOL, window)), ids(many("u", UNPLACED_REMOTE_POOL)), "no-country roles last");
        assert.equal(new Set(ids(pool)).size, pool.length, "no row twice");
        // The pages after the first are the title lanes' next rows.
        assert.deepEqual(ids(pool.slice(window, window + 3)), ids(titles.slice(TITLE_POOL_FLOOR, TITLE_POOL_FLOOR + 3)));
    });

    it("keeps the roles that name no country past its 20 places, after the title and content lanes' rows, so a deeper read weighs them", () => {
        const content = many("c", 100);
        const titles = many("t", 100);
        const unplaced = many("u", 60);
        const pool = composeContentFirstPool({ content, titleLanes: [titles], unplaced, window });
        assert.equal(pool.length, 260, "nothing found is dropped");
        assert.equal(new Set(ids(pool)).size, pool.length, "no row twice");
        assert.equal(first(pool, "u").length, UNPLACED_REMOTE_POOL, "still 20 in the first 150");
        const tail = pool.slice(window);
        assert.deepEqual(ids(tail.slice(-40)), ids(unplaced.slice(UNPLACED_REMOTE_POOL)), "the other 40 come last, in their lanes' order");
        assert.ok(tail.slice(0, -40).every((j) => !j.id.startsWith("u")), "after every placed row");
        // A role the no-country lanes and a placed lane both found is listed once, in its placed row.
        const shared = composeContentFirstPool({ content, titleLanes: [titles], unplaced: [...unplaced, titles[99]!], window });
        assert.equal(ids(shared).filter((id) => id === "t99").length, 1);
        assert.ok(ids(shared).indexOf("t99") < ids(shared).indexOf("u20"));
    });

    it("roles several lanes found take the content places first; roles only one lane found take at most 20 of them", () => {
        const strong = many("s", 50);
        const weak = many("k", 200);
        const pool = composeContentFirstPool({ content: strong, weak, titleLanes: [many("t", 400)], unplaced: many("u", 60), window });
        assert.deepEqual(ids(pool.slice(0, 50)), ids(strong), "strong first");
        assert.equal(first(pool, "k").length, CONTENT_SINGLE_LANE_POOL);
        assert.equal(first(pool, "t").length, window - 50 - CONTENT_SINGLE_LANE_POOL - UNPLACED_REMOTE_POOL, "the title lanes fill the rest");
        // Strong takes the weak places when it holds all 90: the title floor and the cap on one-lane roles both hold.
        const full = composeContentFirstPool({ content: many("s", 200), weak, titleLanes: [many("t", 400)], unplaced: many("u", 60), window });
        assert.equal(first(full, "s").length, 90);
        assert.equal(first(full, "k").length, 0);
        assert.equal(first(full, "t").length, TITLE_POOL_FLOOR);
    });

    it("a one-lane role never takes a place from the title floor, however many the lane found", () => {
        const pool = composeContentFirstPool({ content: [], weak: many("k", 500), titleLanes: [many("t", 400)], unplaced: [], window });
        assert.equal(first(pool, "k").length, CONTENT_SINGLE_LANE_POOL);
        assert.equal(first(pool, "t").length, window - CONTENT_SINGLE_LANE_POOL);
    });

    it("without roles that name no country the content lanes claim 110 and the title lanes still keep 40", () => {
        const pool = composeContentFirstPool({ content: many("c", 200), titleLanes: [many("t", 400)], unplaced: [], window });
        assert.equal(first(pool, "c").length, window - TITLE_POOL_FLOOR);
        assert.equal(first(pool, "t").length, TITLE_POOL_FLOOR);
    });

    it("gives the same share of a smaller page (the hub's first probe steps, Today), never fewer than the title floor's share", () => {
        for (const small of [24, 60, 80]) {
            const pool = composeContentFirstPool({ content: many("c", 200), titleLanes: [many("t", 400)], unplaced: many("u", 60), window: small });
            const page = pool.slice(0, small);
            const share = small / window;
            assert.equal(page.filter((j) => j.id.startsWith("u")).length, Math.ceil(UNPLACED_REMOTE_POOL * share), `no-country places in ${small}`);
            assert.equal(page.filter((j) => j.id.startsWith("t")).length, Math.ceil(TITLE_POOL_FLOOR * share), `title places in ${small}`);
            assert.equal(page.length, small);
        }
    });

    it("gives every place back to the title lanes when the content lanes found nothing", () => {
        const pool = composeContentFirstPool({ content: [], titleLanes: [many("t", 200)], unplaced: [], window });
        assert.deepEqual(ids(pool.slice(0, window)), ids(many("t", window)));
    });

    it("gives the places the title lanes cannot fill to the content lanes' next rows (a niche résumé)", () => {
        const pool = composeContentFirstPool({ content: many("c", 200), titleLanes: [many("t", 10)], unplaced: [], window });
        assert.equal(pool.length, 210, "nothing found is dropped");
        assert.equal(first(pool, "c").length, window - 10);
        assert.equal(first(pool, "t").length, 10);
        assert.equal(new Set(ids(pool)).size, pool.length);
    });

    it("lists a role the title lanes also found once, in the content lanes' place", () => {
        const titles = many("t", 200);
        const pool = composeContentFirstPool({ content: [titles[3]!, job("only")], titleLanes: [titles], unplaced: [], window });
        const page = ids(pool.slice(0, window));
        assert.equal(page.filter((id) => id === "t3").length, 1);
        assert.deepEqual(page.slice(0, 2), ["t3", "only"]);
        assert.equal(page.length, window);
        assert.equal(new Set(page).size, window);
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
                if (body.q.replace(/"/g, "") === "n8n") return jsonResponse(200, { hits: [job("rare-only", "Workflow Specialist"), job("adjacent", "Platform Owner")], totalHits: 40 });
                if (body.q.replace(/"/g, "") === "sql") return jsonResponse(200, { hits: [job("common-only", "Data Clerk")], totalHits: 4_000 });
                if (body.q.replace(/"/g, "") === "ghost") return jsonResponse(200, { hits: [], totalHits: 0 });
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
        assert.deepEqual(ids(result.hits), ["both", "adjacent", "pm"], "the role two phrases found, then the one phrase found, then the title lanes' fill");
    });

    it("the content lanes lead the pool and the title lanes fill what is left", async () => {
        const { result } = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination", "effort estimation"], limit: 150, offset: 0, ...canada });
        const rows = ids(result.hits);
        assert.deepEqual(rows.slice(0, 2), ["both", "adjacent"]);
        assert.equal(rows.at(-1), "pm");
    });

    it("also searches each single skill word in the whole text, and keeps a word's roles only if the lane read every posting that mentions it", async () => {
        const { result, calls } = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination", "n8n", "sql", "ghost"], limit: 150, offset: 0, ...canada });
        for (const word of ["n8n", "sql", "ghost"]) {
            // A short word is sent quoted (exact, no typo matching): the same word.
            const lane = calls.filter((c) => c.q.replace(/"/g, "") === word);
            assert.equal(lane.length, 1, word);
            assert.equal(lane[0]!.matchingStrategy, "all");
            assert.equal(lane[0]!.attributesToSearchOn, undefined, "the whole posting, not its title alone");
            assert.ok(lane[0]!.filter.join(" ").includes('location_country = "Canada"'), "the same country filter as the title lanes");
        }
        const rows = ids(result.hits);
        assert.ok(rows.includes("rare-only"), "a word 40 postings mention is read in full and tells postings apart");
        assert.deepEqual(rows.slice(0, 3), ["adjacent", "rare-only", "both"], "the role a phrase and the word both found leads; the roles one lane found follow, by where their lane put them");
        assert.ok(!rows.includes("common-only"), `a word more than ${CONTENT_LANE_LIMIT} postings mention is read through arbitrary rows and does not: ${rows.join(" | ")}`);
    });

    it("looks for the roles that name no country with each title phrase and the two-word phrases only, never a single word", async () => {
        const asked = await run({ q, sort: "relevance", fromResume: true, contentPhrases: ["release coordination", "n8n"], unplacedRemote: true, limit: 150, offset: 0, ...canada });
        const bare = asked.calls.filter((c) => /location_country IS NULL/.test(c.filter.join(" ")));
        const asks = bare.map((c) => c.q.replace(/"/g, ""));
        // Every title phrase, not only the first: a pack for Product Manager and Product Owner looks for both.
        assert.ok(asks.includes("Product Manager") && asks.includes("Product Owner"), asks.join(" | "));
        assert.ok(asks.includes("release coordination"));
        assert.ok(bare.every((c) => c.q.replace(/"/g, "") !== "n8n"));
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
        assert.deepEqual(resumeContentMark(true, filters.q, pack), { contentPhrases: ["release coordination"], unplacedRemote: true });
        assert.deepEqual(resumeContentMark(true, "data analyst", pack), {});
        assert.deepEqual(resumeContentMark(false, filters.q, pack), {});
        assert.deepEqual(resumeContentMark(true, filters.q, null), {});
        assert.deepEqual(packContentMark([], true), {});
    });

    it("a list with content lanes never shares a cache entry with the same words searched plain", () => {
        const base = { q: "x", fromResume: true, limit: 150 };
        const a = normalizeSearchCacheKey(base);
        assert.notEqual(a, normalizeSearchCacheKey({ ...base, contentPhrases: ["release coordination"] }));
        assert.notEqual(a, normalizeSearchCacheKey({ ...base, unplacedRemote: true }));
    });
});

describe("a deck reads on past the pool's first 150 rows", () => {
    // 2026-10-17 ("just 14 roles?"): a 13-year PM's pack found 226 roles and read 150 of them. The content lanes claim
    // most of the first 150, so the 76 it never scored were mostly the title lanes' rows: his own kind of role.
    const q = formatQuotedOrQuery(["Product Manager", "Product Owner"]);
    async function page(limit: number) {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent(q);
        mock.reset();
        mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).includes("/indexes/jobs/search") && init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as { q: string };
                // Two lanes find each content row, so all 200 are strong: more than the 110 content places.
                if (body.q === "release coordination" || body.q === "effort estimation") return jsonResponse(200, { hits: many("ca", 100), totalHits: 100 });
                if (body.q === "incident command" || body.q === "backlog grooming") return jsonResponse(200, { hits: many("cb", 100), totalHits: 100 });
                if (/product manager/i.test(body.q)) return jsonResponse(200, { hits: many("pm", 150), totalHits: 150 });
                if (/product owner/i.test(body.q)) return jsonResponse(200, { hits: many("po", 150), totalHits: 150 });
            }
            return jsonResponse(200, { hits: [], totalHits: 0 });
        });
        const contentPhrases = ["release coordination", "effort estimation", "incident command", "backlog grooming"];
        const result = await searchMeili({ q, sort: "relevance", fromResume: true, contentPhrases, limit, offset: 0 });
        mock.reset();
        return result;
    }

    it("reads FOR_YOU_READ_DEPTH (300) rows: the first 150 composed as before, then the title lanes' next rows", async () => {
        assert.equal(FOR_YOU_READ_DEPTH, 300);
        const shallow = await page(FOR_YOU_POOL_WINDOW);
        const deep = await page(FOR_YOU_READ_DEPTH);
        assert.equal(deep.total, 500);
        assert.deepEqual(ids(deep.hits.slice(0, FOR_YOU_POOL_WINDOW)), ids(shallow.hits), "the first 150 are the same pool, its title floor kept");
        assert.equal(shallow.hits.filter((j) => j.id.startsWith("c")).length, FOR_YOU_POOL_WINDOW - TITLE_POOL_FLOOR, "the content lanes claim most of the first 150");
        const past = deep.hits.slice(FOR_YOU_POOL_WINDOW);
        assert.equal(past.length, 150);
        assert.ok(past.every((j) => j.id.startsWith("pm") || j.id.startsWith("po")), "past the first 150: the title lanes' next rows");
        assert.equal(new Set(ids(deep.hits)).size, deep.hits.length, "no row twice");
    });
});
