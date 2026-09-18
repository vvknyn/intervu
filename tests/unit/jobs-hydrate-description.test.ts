import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hydrateJobDescription } from "../../src/lib/jobs/hydrate-description";
import { SubspaceJobsError } from "../../src/lib/jobs/subspaceJobs";
import type { JobSearchResult, PublicJob } from "../../src/lib/jobs/types";

function stubHit(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Engineer",
        company: "Acme",
        company_domain: "acme.com",
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
        apply_url: "https://example.com/apply",
        source: "test",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

function stubSearchResult(hits: PublicJob[]): JobSearchResult {
    return { hits, total: hits.length, backend: "meilisearch", configured: true };
}

// hydrateJobDescription reads SUBSPACE_API_KEY (hasSubspaceApiKey) directly —
// no injected dep for it, since it's a cheap env-presence check, not I/O.
// Set/restore it around every test so this file never depends on (or
// leaks) the real key.
const ORIGINAL_KEY = process.env.SUBSPACE_API_KEY;
beforeEach(() => {
    process.env.SUBSPACE_API_KEY = "test-key";
});
afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SUBSPACE_API_KEY;
    else process.env.SUBSPACE_API_KEY = ORIGINAL_KEY;
});

describe("hydrateJobDescription", () => {
    it("a real (non-stub) description never calls the fill — search result is returned as-is", async () => {
        const body = "We are hiring a platform engineer to build reliable systems. ".padEnd(220, "x");
        const hit = stubHit({ id: "job-real", description: body });
        let fillCalled = false;
        const result = await hydrateJobDescription("job-real", null, {
            search: async () => stubSearchResult([hit]),
            fillVisibleDescriptions: async () => {
                fillCalled = true;
                return [];
            },
        });
        assert.equal(fillCalled, false);
        assert.equal(result.hits[0].description, body);
        assert.equal(result.descriptionPending, undefined);
    });

    it("a stub/teaser description awaits the fill and merges the result", async () => {
        const hit = stubHit({ id: "job-stub", description: "" });
        const result = await hydrateJobDescription("job-stub", null, {
            search: async () => stubSearchResult([hit]),
            fillVisibleDescriptions: async (ids) => {
                assert.deepEqual(ids, ["job-stub"]);
                return [{ id: "job-stub", description: "Full posting body from Subspace." }];
            },
        });
        assert.equal(result.hits[0].description, "Full posting body from Subspace.");
        assert.equal(result.descriptionPending, undefined);
    });

    it("a fill that hits its deadline returns the pending shape, not a thrown error", async () => {
        const hit = stubHit({ id: "job-slow", description: "" });
        const result = await hydrateJobDescription("job-slow", null, {
            search: async () => stubSearchResult([hit]),
            fillVisibleDescriptions: async () => {
                throw new SubspaceJobsError("timed out", undefined, "timeout");
            },
        });
        assert.equal(result.descriptionPending, true);
        // The stub hit itself is returned unmodified — never fabricated content.
        assert.equal(result.hits[0].description, "");
    });

    it("a fill that fails for a non-timeout reason degrades quietly (no pending flag, no throw)", async () => {
        const hit = stubHit({ id: "job-broken", description: "" });
        const result = await hydrateJobDescription("job-broken", null, {
            search: async () => stubSearchResult([hit]),
            fillVisibleDescriptions: async () => {
                throw new Error("subspace 500");
            },
        });
        assert.equal(result.descriptionPending, undefined);
        assert.equal(result.hits[0].description, "");
    });

    it("no id-matching hit at all (not_found) never calls the fill", async () => {
        let fillCalled = false;
        const result = await hydrateJobDescription("missing-id", null, {
            search: async () => stubSearchResult([]),
            fillVisibleDescriptions: async () => {
                fillCalled = true;
                return [];
            },
        });
        assert.equal(fillCalled, false);
        assert.equal(result.hits.length, 0);
    });

    it("passes the caller's ip through to search as clientIp", async () => {
        let seenIp: string | undefined;
        await hydrateJobDescription("job-ip", "203.0.113.9", {
            search: async (_params, opts) => {
                seenIp = opts?.clientIp;
                return stubSearchResult([stubHit({ id: "job-ip", description: "x".repeat(300) })]);
            },
        });
        assert.equal(seenIp, "203.0.113.9");
    });

    it("without SUBSPACE_API_KEY, never calls the fill even for a stub description", async () => {
        delete process.env.SUBSPACE_API_KEY;
        let fillCalled = false;
        const hit = stubHit({ id: "job-nokey", description: "" });
        const result = await hydrateJobDescription("job-nokey", null, {
            search: async () => stubSearchResult([hit]),
            fillVisibleDescriptions: async () => {
                fillCalled = true;
                return [];
            },
        });
        assert.equal(fillCalled, false);
        assert.equal(result.descriptionPending, undefined);
    });
});
