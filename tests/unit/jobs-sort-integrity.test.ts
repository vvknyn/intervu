/**
 * The 2026-08-14 incident: Meilisearch's searchCutoffMs (default 1500ms,
 * raised to 5000ms in JOBS_INDEX_SETTINGS — meilisearch.ts) interrupted slow
 * searches under embed-batch/indexing load and returned partial results with
 * the explicit `sort` only PARTIALLY applied — a FRESHEST page that restarted
 * its own order mid-list (8 restarts observed in one 40-hit page). These
 * tests pin `searchMeili`'s sort-integrity chokepoint: never render an order
 * that wasn't verified. Coverage spans newest (the incident) AND salary_desc
 * (a mode the incident never touched, proving the fix is class-wide, not
 * newest-specific) plus relevance mode (must be left alone entirely).
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

// newest-mode fixtures: page 1 restarts its own order (the incident shape),
// page 2 is the same three docs correctly ordered.
const NEWEST_UNSORTED = [
    job({ id: "a", posted_at: "2026-01-05T00:00:00Z" }),
    job({ id: "b", posted_at: "2026-01-01T00:00:00Z" }),
    job({ id: "c", posted_at: "2026-01-06T00:00:00Z" }),
];
const NEWEST_SORTED = [
    job({ id: "c", posted_at: "2026-01-06T00:00:00Z" }),
    job({ id: "a", posted_at: "2026-01-05T00:00:00Z" }),
    job({ id: "b", posted_at: "2026-01-01T00:00:00Z" }),
];

describe("searchMeili sort-integrity guard — newest (the incident)", () => {
    it("retries once on an unsorted strict-pass page and returns the retry's hits when the retry is sorted", async () => {
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return calls === 1
                ? jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: NEWEST_UNSORTED.length })
                : jsonResponse(200, { hits: NEWEST_SORTED, totalHits: NEWEST_SORTED.length });
        });

        const result = await searchMeili({ sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "a", "b"], "returns the retry's hits, unmodified");
        assert.equal(calls, 2, "exactly one retry — strict pass + one retry, no more");
        mock.reset();
    });

    it("re-sorts locally and warns when the retry is STILL unsorted — at most one retry per call", async () => {
        let calls = 0;
        const warnings: unknown[][] = [];
        mock.method(console, "warn", (...args: unknown[]) => {
            warnings.push(args);
        });
        mock.method(globalThis, "fetch", async () => {
            calls++;
            // Both passes come back unsorted — engine is still degraded.
            return jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: NEWEST_UNSORTED.length });
        });

        const result = await searchMeili({ sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "a", "b"], "locally re-sorted into correct newest order");
        assert.equal(calls, 2, "at most one retry — never a third fetch chasing a still-degraded engine");
        assert.ok(
            warnings.some((args) => String(args[0]).includes("sort-integrity")),
            "logs the sort-integrity warning so the degradation is visible in prod logs",
        );
        mock.reset();
    });
});

describe("searchMeili sort-integrity guard — relevance mode is never touched", () => {
    it("does not check or retry an unsorted-looking page under relevance", async () => {
        // Pre-warm the company-intent cache so `resolveCompanyIntent`'s own
        // probe (fired for any non-empty q) doesn't add a call to the count
        // below — that probe is a separate concern from the sort-integrity
        // retry this test is pinning.
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("engineer");
        mock.reset();

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            // Out of newest order — irrelevant, relevance mode must ignore it.
            return jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: NEWEST_UNSORTED.length });
        });

        const result = await searchMeili({ q: "engineer" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "hits pass through exactly as the engine returned them");
        assert.equal(calls, 1, "no retry — relevance has no engine-decided order to verify");
        mock.reset();
    });
});

describe("searchMeili sort-integrity guard — salary_desc (a mode the 2026-08-14 incident never surfaced)", () => {
    it("guards salary_desc the same way as newest", async () => {
        const unsorted = [
            job({ id: "a", salary_max: 120_000 }),
            job({ id: "b", salary_max: 90_000 }),
            job({ id: "c", salary_max: 200_000 }),
        ];
        const sorted = [
            job({ id: "c", salary_max: 200_000 }),
            job({ id: "a", salary_max: 120_000 }),
            job({ id: "b", salary_max: 90_000 }),
        ];
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return calls === 1
                ? jsonResponse(200, { hits: unsorted, totalHits: unsorted.length })
                : jsonResponse(200, { hits: sorted, totalHits: sorted.length });
        });

        const result = await searchMeili({ sort: "salary_desc" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "a", "b"]);
        assert.equal(calls, 2);
        mock.reset();
    });
});

/**
 * 2026-08-14: `typo` now sits ahead of `sort` in `rankingRules`
 * (JOBS_INDEX_SETTINGS, meilisearch.ts), so an explicit-sort + non-empty-q
 * search is scoped to title+company (`shouldScopeTextMatchToTitle`, sort.ts)
 * and can legitimately restart its date/salary order at the boundary
 * between the 0-typo bucket and a looser typo-admit bucket — that restart
 * is the new rule order working as intended, NOT the searchCutoffMs
 * partial-sort disorder the guard above exists to catch. These pin the
 * guard's new invariant: check sortedness on the TITLED subsequence only
 * (`sortVerifiableHits`, sort.ts) when scoping is active, and keep the
 * original whole-page check when it isn't (empty q, or relevance).
 */
describe("searchMeili sort-integrity guard — scoped mode (typo-bucket boundary)", () => {
    it("passes when the titled subsequence is monotonic even though the full page restarts at a typo-bucket boundary", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("engineer");
        mock.reset();

        // "b" is a typo/fuzzy admit (title doesn't match "engineer" at all —
        // stands in for the class) whose own date sits BETWEEN "a" and "c",
        // breaking the full page's newest-first order. The titled
        // subsequence [a, c] is, on its own, correctly newest-first.
        const page = [
            job({ id: "a", title: "Engineer", posted_at: "2026-01-10T00:00:00Z" }),
            job({ id: "b", title: "Manager", posted_at: "2026-01-15T00:00:00Z" }),
            job({ id: "c", title: "Senior Engineer", posted_at: "2026-01-05T00:00:00Z" }),
        ];

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return jsonResponse(200, { hits: page, totalHits: page.length });
        });

        const result = await searchMeili({ q: "engineer", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "page returned as-is — no retry, no local re-sort");
        assert.equal(calls, 1, "titled subsequence [a, c] is monotonic, so the whole page is treated as sorted");
        mock.reset();
    });

    it("still retries when the titled subsequence itself is disordered", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("engineer");
        mock.reset();

        // Titled hits [a, c] are themselves OUT of newest-first order (a is
        // older than c) — a genuine disorder the scoped check must still catch.
        const unsorted = [
            job({ id: "a", title: "Engineer", posted_at: "2026-01-05T00:00:00Z" }),
            job({ id: "b", title: "Manager", posted_at: "2026-01-08T00:00:00Z" }),
            job({ id: "c", title: "Senior Engineer", posted_at: "2026-01-10T00:00:00Z" }),
        ];
        const sorted = [unsorted[2], unsorted[1], unsorted[0]];

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return calls === 1
                ? jsonResponse(200, { hits: unsorted, totalHits: unsorted.length })
                : jsonResponse(200, { hits: sorted, totalHits: sorted.length });
        });

        const result = await searchMeili({ q: "engineer", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "b", "a"], "returns the retry's hits once the titled subsequence is sorted");
        assert.equal(calls, 2, "retried once — titled subsequence [a, c] was genuinely disordered");
        mock.reset();
    });

    it("keeps whole-page semantics when q is empty, even under an explicit sort — scoping never fires without query text", async () => {
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: NEWEST_UNSORTED.length });
        });

        const result = await searchMeili({ q: "", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "a", "b"], "locally re-sorted — whole-page check still applies with no query text");
        assert.equal(calls, 2, "retry still fires: an empty q never scopes, regardless of sort mode");
        mock.reset();
    });

    it("guards salary_desc scoped mode the same way as newest", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("engineer");
        mock.reset();

        // "b" (not titled) carries the highest salary, breaking the full
        // page's descending order; the titled subsequence [a, c] is on its
        // own correctly salary-descending.
        const page = [
            job({ id: "a", title: "Engineer", salary_max: 150_000 }),
            job({ id: "b", title: "Manager", salary_max: 999_999 }),
            job({ id: "c", title: "Senior Engineer", salary_max: 100_000 }),
        ];

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return jsonResponse(200, { hits: page, totalHits: page.length });
        });

        const result = await searchMeili({ q: "engineer", sort: "salary_desc" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"]);
        assert.equal(calls, 1, "titled subsequence [a, c] is salary-descending, so no retry fires");
        mock.reset();
    });
});
