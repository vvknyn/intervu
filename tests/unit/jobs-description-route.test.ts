/**
 * GET /api/jobs/[id]/description — shares `hydrateJobDescription`
 * (lib/jobs/hydrate-description.ts, unit-tested in
 * jobs-hydrate-description.test.ts) with `searchJobsAction`'s own id path,
 * so "identical payload shape for the id path" is structurally guaranteed
 * by the extraction itself: both callers now pass the function's return
 * value straight through with no reshaping (verified: this route's `GET`
 * body below is `NextResponse.json(result, describeResponseInit(result))`
 * with no field added/removed/renamed, and actions/jobs.ts's id branch is
 * `return hydrateJobDescription(params.id, ip);` — same, no wrapping).
 *
 * `isValidJobId` and `describeResponseInit` are pure and pinned directly.
 * `GET` itself is only exercised for the invalid-id 400 short-circuit —
 * any valid id reaches `getClientIp()`, which calls next/headers's
 * `headers()` and throws outside a real request scope, same class of
 * coupling `jobs-suggest-route.test.ts` already documents for its own
 * route's `GET`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, isValidJobId, describeResponseInit } from "../../src/app/api/jobs/[id]/description/route";
import type { HydrateDescriptionResult } from "../../src/lib/jobs/hydrate-description";
import type { PublicJob } from "../../src/lib/jobs/types";

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

function stubResult(overrides: Partial<HydrateDescriptionResult> = {}): HydrateDescriptionResult {
    return {
        hits: [stubHit({ id: "job-1", description: "x".repeat(300) })],
        total: 1,
        backend: "meilisearch",
        configured: true,
        searchId: "search-1",
        ...overrides,
    };
}

describe("isValidJobId", () => {
    it("rejects undefined, empty, and whitespace-only ids", () => {
        assert.equal(isValidJobId(undefined), false);
        assert.equal(isValidJobId(""), false);
        assert.equal(isValidJobId("   "), false);
    });

    it("accepts a normal id", () => {
        assert.equal(isValidJobId("job-abc-123"), true);
    });

    it("rejects an id past the 200-char cap, accepts one at it", () => {
        assert.equal(isValidJobId("a".repeat(200)), true);
        assert.equal(isValidJobId("a".repeat(201)), false);
    });
});

describe("describeResponseInit — Cache-Control only when complete", () => {
    it("a complete (non-stub) result gets a private 60s Cache-Control", () => {
        const init = describeResponseInit(stubResult());
        assert.equal((init?.headers as Record<string, string>)["Cache-Control"], "private, max-age=60");
    });

    it("a complete result for a hit that WAS a stub (fill succeeded) still gets cached", () => {
        const init = describeResponseInit(
            stubResult({ hits: [stubHit({ id: "job-2", description: "Filled body." })] }),
        );
        assert.equal((init?.headers as Record<string, string>)["Cache-Control"], "private, max-age=60");
    });

    it("a descriptionPending result is never cached (init is undefined)", () => {
        const init = describeResponseInit(stubResult({ descriptionPending: true }));
        assert.equal(init, undefined);
    });
});

describe("GET /api/jobs/[id]/description — invalid id short-circuit", () => {
    it("400s a whitespace-only id without reaching getClientIp/the rate limiter", async () => {
        const res = await GET(new Request("http://x/api/jobs/%20/description"), {
            params: Promise.resolve({ id: "   " }),
        });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: "invalid id" });
    });

    it("400s an id past the length cap", async () => {
        const res = await GET(new Request("http://x/api/jobs/x/description"), {
            params: Promise.resolve({ id: "a".repeat(201) }),
        });
        assert.equal(res.status, 400);
    });
});
