/**
 * The animana--com incident: a Meilisearch search failure (400
 * invalid_search_filter — company_domain not filterable) came back as an
 * empty result, and getCompanyPageData read that as "zero jobs" and 404'd a
 * company page that should have been a 500. These tests pin the fix at the
 * exact chokepoint that swallowed it — using a search-result mock, not a real
 * Meilisearch call, since the underlying `search` dependency is injected
 * (matching the SearchFn pattern already used by hot-list.ts / follows/
 * alerts.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCompanyPageData } from "@/lib/companies/get-company";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Engineer",
        company: "Animana",
        company_domain: "animana.com",
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
        ghost_badge: "clear",
        ...overrides,
    };
}

describe("getCompanyPageData", () => {
    it("throws when searchJobs signals a failure — never notFound() for an infrastructure error", async () => {
        const failing = async (_p: JobSearchParams): Promise<JobSearchResult> => ({
            hits: [],
            total: 0,
            backend: "meilisearch",
            configured: true,
            unavailable: true,
            note: SEARCH_UNAVAILABLE_MESSAGE,
        });

        await assert.rejects(() => getCompanyPageData("animana--com", failing));
    });

    it("throws on failure for a company on a different board too (class-wide, not company_domain-specific)", async () => {
        const failing = async (_p: JobSearchParams): Promise<JobSearchResult> => ({
            hits: [],
            total: 0,
            backend: "meilisearch",
            configured: true,
            unavailable: true,
            note: "Search is temporarily unavailable — index misconfigured (invalid_search_facets).",
        });

        await assert.rejects(() => getCompanyPageData("stripe--com", failing));
    });

    it("returns null for a genuine zero-hits, zero-boards company — the real 404 stays correct", async () => {
        const empty = async (_p: JobSearchParams): Promise<JobSearchResult> => ({
            hits: [],
            total: 0,
            backend: "meilisearch",
            configured: true,
        });

        const result = await getCompanyPageData("totally-unknown-co--test", empty);
        assert.equal(result, null);
    });

    it("returns company data when the search genuinely succeeds with hits", async () => {
        const succeeding = async (_p: JobSearchParams): Promise<JobSearchResult> => ({
            hits: [job({ id: "1" })],
            total: 1,
            backend: "meilisearch",
            configured: true,
        });

        const result = await getCompanyPageData("animana--com", succeeding);
        assert.ok(result);
        assert.equal(result?.domain, "animana.com");
        assert.equal(result?.jobs.length, 1);
    });
});
