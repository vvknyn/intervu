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
import { COMPANY_JOBS_FETCH_LIMIT, getCompanyPageData } from "@/lib/companies/get-company";
import { CORPUS_COUNT_CAP } from "@/lib/jobs/corpus-count";
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

/** `n` hits at one company — a saturated window is the shape the old
 *  `jobs.length` count silently truncated to exactly `limit`. */
function hits(n: number, overrides: Partial<PublicJob> = {}): PublicJob[] {
    return Array.from({ length: n }, (_, i) => job({ id: String(i), ...overrides }));
}

const ok = (r: Partial<JobSearchResult> & Pick<JobSearchResult, "hits" | "total">) =>
    async (_p: JobSearchParams): Promise<JobSearchResult> => ({
        backend: "meilisearch",
        configured: true,
        ...r,
    });

describe("getCompanyPageData — open-role count is never a window length", () => {
    it("reports the backend's exact total, not the capped hit window (the adyen '200' bug)", async () => {
        const search = ok({ hits: hits(COMPANY_JOBS_FETCH_LIMIT), total: 1500 });

        const result = await getCompanyPageData("adyen--com", search);
        assert.equal(result?.openCount, 1500);
        assert.equal(result?.openCountIsLowerBound, false);
        assert.equal(result?.jobs.length, COMPANY_JOBS_FETCH_LIMIT);
    });

    it("flags a lower bound when a SATURATED window came from a qualified (post-filter) result", async () => {
        // searchWithDomainPostFilter early-stops once it has enough for the
        // page: its `total` is the scan window's match count, and it always
        // attaches a note. Same class as the exact case above, different path.
        const search = ok({
            hits: hits(COMPANY_JOBS_FETCH_LIMIT),
            total: COMPANY_JOBS_FETCH_LIMIT,
            note: "Company domain filter applied locally (count is a lower bound)",
        });

        const result = await getCompanyPageData("stripe--com", search);
        assert.equal(result?.openCount, COMPANY_JOBS_FETCH_LIMIT);
        assert.equal(result?.openCountIsLowerBound, true);
    });

    it("keeps an UNSATURATED qualified result exact — it was fully enumerated", async () => {
        const search = ok({ hits: hits(12), total: 12, note: "Company domain filter applied locally" });

        const result = await getCompanyPageData("stripe--com", search);
        assert.equal(result?.openCount, 12);
        assert.equal(result?.openCountIsLowerBound, false);
    });

    it("flags a lower bound at the Meilisearch maxTotalHits cap (no note, no saturation needed)", async () => {
        const search = ok({ hits: hits(10), total: CORPUS_COUNT_CAP });

        const result = await getCompanyPageData("stripe--com", search);
        assert.equal(result?.openCount, CORPUS_COUNT_CAP);
        assert.equal(result?.openCountIsLowerBound, true);
    });

    it("flags a lower bound for the capped snapshot-preview backend even when unsaturated", async () => {
        const search = async (_p: JobSearchParams): Promise<JobSearchResult> => ({
            hits: hits(3),
            total: 3,
            backend: "snapshot-preview",
            configured: true,
            preview: true,
        });

        const result = await getCompanyPageData("stripe--com", search);
        assert.equal(result?.openCountIsLowerBound, true);
    });

    it("never reports fewer roles than it is about to list", async () => {
        const search = ok({ hits: hits(50), total: 0 });

        const result = await getCompanyPageData("stripe--com", search);
        assert.equal(result?.openCount, 50);
    });
});

describe("getCompanyPageData — name repair is a rule, not a lookup table", () => {
    it("recovers casing from a sibling row rather than trusting row 0 ('1password' -> '1Password')", async () => {
        const search = ok({
            hits: [
                job({ id: "1", company: "1password", company_domain: "1password.com" }),
                job({ id: "2", company: "1password", company_domain: "1password.com" }),
                job({ id: "3", company: "1Password", company_domain: "1password.com" }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("1password--com", search);
        assert.equal(result?.name, "1Password");
        assert.equal(result?.nameSource, "corpus-cased");
    });

    it("recovers a DIFFERENT employer's casing by the same rule ('23andme' -> '23andMe')", async () => {
        const search = ok({
            hits: [
                job({ id: "1", company: "23andme", company_domain: "23andme.com" }),
                job({ id: "2", company: "23andMe", company_domain: "23andme.com" }),
            ],
            total: 2,
        });

        const result = await getCompanyPageData("23andme--com", search);
        assert.equal(result?.name, "23andMe");
        assert.equal(result?.nameSource, "corpus-cased");
    });

    it("exposes uncertainty instead of guessing when NO row carries case", async () => {
        const search = ok({
            hits: hits(3, { company: "10xgenomics", company_domain: "10xgenomics.com" }),
            total: 3,
        });

        const result = await getCompanyPageData("10xgenomics--com", search);
        // Verbatim corpus string — NOT a reconstructed "10x Genomics".
        assert.equal(result?.name, "10xgenomics");
        assert.equal(result?.nameSource, "corpus-flat");
    });

    it("lets the name most rows agree on win, so one odd row cannot rename the page", async () => {
        const search = ok({
            hits: [
                job({ id: "1", company: "Acme Staffing Partners", company_domain: "acme.com" }),
                job({ id: "2", company: "Acme Robotics", company_domain: "acme.com" }),
                job({ id: "3", company: "Acme Robotics", company_domain: "acme.com" }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("acme--com", search);
        assert.equal(result?.name, "Acme Robotics");
    });

    it("falls back to a domain label when the corpus name is unusable, and says so", async () => {
        const search = ok({
            hits: hits(2, { company: "acme-corp.applicantpro.com", company_domain: "acme-corp.com" }),
            total: 2,
        });

        const result = await getCompanyPageData("acme-corp--com", search);
        assert.equal(result?.name, "Acme Corp");
        assert.equal(result?.nameSource, "domain");
    });

    it("leaves an already-correct mixed-case name untouched", async () => {
        const search = ok({ hits: hits(2, { company: "Adyen", company_domain: "adyen.com" }), total: 2 });

        const result = await getCompanyPageData("adyen--com", search);
        assert.equal(result?.name, "Adyen");
        assert.equal(result?.nameSource, "corpus-cased");
    });
});

describe("getCompanyPageData — hasTrackRecord gates on real data", () => {
    it("is false when the company_* aggregates are absent (every employer today)", async () => {
        const search = ok({ hits: hits(3), total: 3 });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.hasTrackRecord, false);
        assert.equal(result?.opened90d, null);
        assert.equal(result?.closed90d, null);
    });

    it("is true once BOTH aggregates arrive — the gate is data, not a hardcoded false", async () => {
        const search = ok({
            hits: hits(3, { company_opened_90d: 14, company_closed_90d: 9 }),
            total: 3,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.hasTrackRecord, true);
        assert.equal(result?.opened90d, 14);
        assert.equal(result?.closed90d, 9);
    });

    it("stays false when only ONE side is known — half a history is not a track record", async () => {
        const search = ok({ hits: hits(3, { company_opened_90d: 14 }), total: 3 });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.hasTrackRecord, false);
    });
});
