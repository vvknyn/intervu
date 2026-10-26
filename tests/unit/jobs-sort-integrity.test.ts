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

    it("delivers the engine's order and warns when the retry is STILL unsorted — never a one-page local re-sort, at most one retry per call", async () => {
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

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "as the engine sent it: a re-sort would fix this page and nothing after it");
        assert.equal(calls, 2, "at most one retry — never a third fetch chasing a still-degraded engine");
        assert.ok(
            warnings.some((args) => String(args[0]).includes("sort-integrity")),
            "logs the sort-integrity warning so the degradation is visible in prod logs",
        );
        mock.reset();
    });
});

describe("searchMeili reports the engine's own time, the retry included", () => {
    it("sums the engine time and requests of the first pass and its retry", async () => {
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return calls === 1
                ? jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: 3, processingTimeMs: 400 })
                : jsonResponse(200, { hits: NEWEST_SORTED, totalHits: 3, processingTimeMs: 300 });
        });

        const result = await searchMeili({ sort: "newest" });

        assert.equal(result.engineMs, 700);
        assert.equal(result.engineCalls, 2);
        mock.reset();
    });

    it("reports one request when the first page is already in order", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, { hits: NEWEST_SORTED, totalHits: 3, processingTimeMs: 25 }),
        );

        const result = await searchMeili({ sort: "newest" });

        assert.equal(result.engineMs, 25);
        assert.equal(result.engineCalls, 1);
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
            // totalHits is a full page (>= RELAX_MIN_HITS) so the unrelated
            // thin-result relax pass (shouldRelaxSearch) doesn't fire and add
            // a second fetch — this test pins the sort-integrity retry count.
            return jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: 25 });
        });

        const result = await searchMeili({ q: "engineer" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "hits pass through exactly as the engine returned them");
        // A bare role query ("engineer") is now `runTieredRetrieval`'s one
        // federated /multi-search PLUS one parallel tier1Total count pass —
        // 2 real fetches for this one logical search pass, not 1. No RETRY
        // fires (calls stays at exactly 2, not 4): relevance mode is still
        // never checked or re-issued.
        assert.equal(calls, 2, "no retry — relevance has no engine-decided order to verify");
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
 * `typo` sits ahead of `sort` in `rankingRules` (JOBS_INDEX_SETTINGS), so a typed explicit-sort search legitimately
 * restarts its order where the typo count changes. The guard reads the engine's own typo score
 * (`_rankingScoreDetails.typo.score`) to tell that boundary from the searchCutoffMs disorder it exists to catch,
 * and checks EVERY hit of a group, not only the ones whose title holds the typed words.
 */
const withTypo = (overrides: Partial<PublicJob> & Pick<PublicJob, "id">, typoScore: number): PublicJob =>
    ({ ...job(overrides), _rankingScoreDetails: { typo: { score: typoScore } } }) as PublicJob;
const inGroup = (hit: PublicJob, queriesPosition: 0 | 1): PublicJob => ({ ...hit, _federation: { queriesPosition } }) as PublicJob;

describe("searchMeili sort-integrity guard — typed search (typo-bucket boundary, groups)", () => {
    it("passes when the page restarts its order only where the engine says the typo count changed", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("engineer");
        mock.reset();

        // "b" is a typo/fuzzy admit (title doesn't match "engineer" at all —
        // stands in for the class) whose own date sits BETWEEN "a" and "c",
        // breaking the full page's newest-first order. The titled
        // subsequence [a, c] is, on its own, correctly newest-first.
        const page = [
            withTypo({ id: "a", title: "Engineer", posted_at: "2026-01-10T00:00:00Z" }, 1),
            withTypo({ id: "b", title: "Manager", posted_at: "2026-01-15T00:00:00Z" }, 0.5),
            withTypo({ id: "c", title: "Senior Engineer", posted_at: "2026-01-05T00:00:00Z" }, 1),
        ];

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            // Full page (>= RELAX_MIN_HITS) so the unrelated thin-result relax
            // pass doesn't fire — this test pins the sort-integrity retry count.
            return jsonResponse(200, { hits: page, totalHits: 25 });
        });

        const result = await searchMeili({ q: "engineer", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "page returned as-is — no retry, no local re-sort");
        assert.ok(result.hits.every((h) => !("_rankingScoreDetails" in h)), "the engine's scores never leave the server");
        // 2, not 1: a bare role query is `runTieredRetrieval`'s one federated
        // /multi-search plus one parallel tier1Total count pass — still only
        // ONE logical search pass (no retry), just 2 real fetches for it.
        assert.equal(calls, 2, "the only restarts sit on typo-bucket boundaries, so the page is treated as sorted");
        mock.reset();
    });

    it("still retries when same-bucket hits are disordered", async () => {
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
            // Full page (>= RELAX_MIN_HITS) on both passes so the unrelated
            // thin-result relax pass doesn't fire — this test pins the
            // sort-integrity retry, not the relax mechanism.
            return calls === 1
                ? jsonResponse(200, { hits: unsorted, totalHits: 25 })
                : jsonResponse(200, { hits: sorted, totalHits: 25 });
        });

        const result = await searchMeili({ q: "engineer", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["c", "b", "a"], "returns the retry's hits once the titled subsequence is sorted");
        // 4, not 2: each of the two logical passes (initial + the one retry)
        // is `runTieredRetrieval`'s federated /multi-search plus its parallel
        // tier1Total count pass — 2 real fetches per pass, still exactly one
        // retry.
        assert.equal(calls, 4, "retried once — titled subsequence [a, c] was genuinely disordered");
        mock.reset();
    });

    it("keeps whole-page semantics when q is empty, even under an explicit sort — scoping never fires without query text", async () => {
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return jsonResponse(200, { hits: NEWEST_UNSORTED, totalHits: NEWEST_UNSORTED.length });
        });

        const result = await searchMeili({ q: "", sort: "newest" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"], "as sent — the whole page is still checked with no query text");
        assert.equal(calls, 2, "retry still fires for an empty q, regardless of sort mode");
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
            withTypo({ id: "a", title: "Engineer", salary_max: 150_000 }, 1),
            withTypo({ id: "b", title: "Manager", salary_max: 999_999 }, 0.5),
            withTypo({ id: "c", title: "Senior Engineer", salary_max: 100_000 }, 1),
        ];

        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            // Full page (>= RELAX_MIN_HITS) so the unrelated thin-result relax
            // pass doesn't fire — this test pins the sort-integrity retry count.
            return jsonResponse(200, { hits: page, totalHits: 25 });
        });

        const result = await searchMeili({ q: "engineer", sort: "salary_desc" });

        assert.deepEqual(result.hits.map((h) => h.id), ["a", "b", "c"]);
        // 2, not 1 — see the "monotonic" test above for why a no-retry pass
        // is 2 real fetches under `runTieredRetrieval`.
        assert.equal(calls, 2, "the only restart is a typo-bucket boundary, so no retry fires");
        mock.reset();
    });
});

describe("searchMeili sort-integrity guard — each group is checked on its own, every hit of it", () => {
    async function pageFor(page: PublicJob[], retryPage: PublicJob[] = page) {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [], totalHits: 0 }));
        await resolveCompanyIntent("physical therapist");
        mock.reset();
        let calls = 0;
        mock.method(globalThis, "fetch", async () => {
            calls++;
            return jsonResponse(200, { hits: calls <= 2 ? page : retryPage, totalHits: 25 });
        });
        const result = await searchMeili({ q: "physical therapist", sort: "newest" });
        mock.reset();
        return { result, calls };
    }

    it("passes two groups that each run newest-first even though the page restarts at the divider", async () => {
        const { result, calls } = await pageFor([
            inGroup(job({ id: "a", title: "Physical Therapist", posted_at: "2026-01-10T00:00:00Z" }), 0),
            inGroup(job({ id: "b", title: "Clinical Fellow/Therapist", posted_at: "2026-01-04T00:00:00Z" }), 0),
            inGroup(job({ id: "c", title: "Teacher", posted_at: "2026-01-09T00:00:00Z" }), 1),
            inGroup(job({ id: "d", title: "Aide", posted_at: "2026-01-02T00:00:00Z" }), 1),
        ]);
        assert.equal(calls, 2, "no retry");
        assert.deepEqual(result.hits.map((h) => [h.id, h.tier]), [["a", 1], ["b", 1], ["c", 2], ["d", 2]]);
    });

    it("catches disorder among hits whose title lacks the typed words (the old guard saw only full-title matches)", async () => {
        const broken = [
            inGroup(job({ id: "a", title: "Clinical Fellow/Therapist", posted_at: "2026-01-02T00:00:00Z" }), 0),
            inGroup(job({ id: "b", title: "Supervised Instructor", posted_at: "2026-01-08T00:00:00Z" }), 0),
        ];
        const { calls } = await pageFor(broken);
        assert.equal(calls, 4, "one retry, each pass being a federated search plus its count pass");
    });

    it("catches disorder inside the group below the divider", async () => {
        const broken = [
            inGroup(job({ id: "a", title: "Physical Therapist", posted_at: "2026-01-10T00:00:00Z" }), 0),
            inGroup(job({ id: "b", title: "Teacher", posted_at: "2026-01-02T00:00:00Z" }), 1),
            inGroup(job({ id: "c", title: "Aide", posted_at: "2026-01-08T00:00:00Z" }), 1),
        ];
        const { calls } = await pageFor(broken);
        assert.equal(calls, 4);
    });
});
