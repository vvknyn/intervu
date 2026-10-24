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
        // Distinct per hit by default (keyed on `id`, which every call site
        // already sets uniquely) so `collapseDuplicatePostings` — applied by
        // `getCompanyPageData` since the Stewart 66-vs-62 fix — never treats
        // these tests' intentionally-distinct sibling rows (same default
        // title, no location override) as re-synced duplicates of one
        // another. Dedup-collision behavior itself is covered separately in
        // company-dedupe-postings.test.ts, whose own `job()` factory keeps a
        // fixed null location precisely so same-key rows DO collide.
        location_city: `Test City ${overrides.id}`,
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

    // The Stewart seam, end to end: a re-synced duplicate reaching this
    // chokepoint used to inflate `openCount` (sourced from the pre-dedup hit
    // count) past `jobs.length` (deduped a second time, client-side, in
    // CompanyRoleSearch) — 66 vs 62, live. Both numbers now come from the
    // SAME final array, so they can't disagree.
    it("closes the Stewart seam: openCount equals jobs.length even when a re-synced duplicate reaches the fetch", async () => {
        const search = ok({
            hits: [
                job({ id: "1", title: "Escrow Operations Intern", location_city: "Sioux Falls" }),
                job({ id: "2", title: "Escrow Operations Intern", location_city: "Sioux Falls" }), // re-synced dupe of "1"
                job({ id: "3", title: "Loan Officer", location_city: "Sioux Falls" }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("stewart--com", search);
        assert.equal(result?.jobs.length, 2);
        assert.equal(result?.openCount, result?.jobs.length);
        assert.equal(result?.openCountIsLowerBound, false);
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

    it("recovers casing on a corpus-flat name the same way a domain fallback would, when NO row carries case", async () => {
        const search = ok({
            hits: hits(3, { company: "10xgenomics", company_domain: "10xgenomics.com" }),
            total: 3,
        });

        const result = await getCompanyPageData("10xgenomics--com", search);
        // A winning group with no cased witness carries zero casing
        // information — exactly as caseless as a domain label — so it gets
        // the same capitalize-after-non-letter recovery, not a fabricated
        // "10x Genomics", and not the raw lowercase string either.
        assert.equal(result?.name, "10Xgenomics");
        assert.equal(result?.nameSource, "corpus-flat");
    });

    // 82d4b0da (2026-10-24): the host-spelled stem is the brand when only qualified entities exist.
    it("lets the brand stem the host spells win over qualified entity names, so one odd row cannot rename the page to its own name", async () => {
        const search = ok({
            hits: [
                job({ id: "1", company: "Acme Staffing Partners", company_domain: "acme.com" }),
                job({ id: "2", company: "Acme Robotics", company_domain: "acme.com" }),
                job({ id: "3", company: "Acme Robotics", company_domain: "acme.com" }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("acme--com", search);
        assert.equal(result?.name, "Acme");
        assert.notEqual(result?.name, "Acme Staffing Partners");
    });

    it("falls back to a domain label when the corpus name is unusable, and says so", async () => {
        const search = ok({
            // Was acme-corp.com → "Acme Corp"; #384 (7ac05f9a) now strips bare
            // "Corp" at display, so the fixture uses a domain with no legal word.
            hits: hits(2, { company: "acme-robotics.applicantpro.com", company_domain: "acme-robotics.com" }),
            total: 2,
        });

        const result = await getCompanyPageData("acme-robotics--com", search);
        assert.equal(result?.name, "Acme Robotics");
        assert.equal(result?.nameSource, "domain");
    });

    it("leaves an already-correct mixed-case name untouched", async () => {
        const search = ok({ hits: hits(2, { company: "Adyen", company_domain: "adyen.com" }), total: 2 });

        const result = await getCompanyPageData("adyen--com", search);
        assert.equal(result?.name, "Adyen");
        assert.equal(result?.nameSource, "corpus-cased");
    });

    it("strips the corpus's trailing legal suffix from the DISPLAYED name (the servicetitan.com incident)", async () => {
        const search = ok({
            hits: hits(2, { company: "LE0001 ServiceTitan, Inc.", company_domain: "servicetitan.com" }),
            total: 2,
        });

        const result = await getCompanyPageData("servicetitan--com", search);
        assert.equal(result?.name, "ServiceTitan");
        // Casing provenance is a separate concern from suffix-stripping —
        // still reported honestly against the pre-strip corpus string.
        assert.equal(result?.nameSource, "corpus-cased");
    });

    it("strips a legal suffix for a DIFFERENT employer too — proves the fix is class-wide, not servicetitan-specific", async () => {
        const search = ok({ hits: hits(2, { company: "Apple Inc.", company_domain: "apple.com" }), total: 2 });

        const result = await getCompanyPageData("apple--com", search);
        assert.equal(result?.name, "Apple");
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

/**
 * The `company_*` aggregates reach Meilisearch document by document as the sync
 * re-writes them, so a company's hit window is a mix of carrying and
 * not-yet-carrying documents. Reading them off `jobs[0]` made the track record
 * appear only when the FIRST hit happened to be one of the re-synced ones.
 */
describe("getCompanyPageData — aggregates come from whichever hit carries them", () => {
    it("finds the track record on a LATER hit when the leading hits carry nothing", async () => {
        const search = ok({
            hits: [
                job({ id: "1" }),
                job({ id: "2" }),
                job({ id: "3", company_opened_90d: 224, company_closed_90d: 203 }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("akamai--com", search);
        assert.equal(result?.opened90d, 224);
        assert.equal(result?.closed90d, 203);
        assert.equal(result?.hasTrackRecord, true);
    });

    it("finds it for a different employer whose only carrying hit is LAST in the window", async () => {
        // Same rule, different company and a different position — the fix is
        // "any hit", not "hit 0 or hit 3".
        const carrying = job({ id: "last", company_opened_90d: 94, company_closed_90d: 41 });
        const search = ok({ hits: [...hits(40), carrying], total: 41 });

        const result = await getCompanyPageData("airwallex--com", search);
        assert.equal(result?.opened90d, 94);
        assert.equal(result?.closed90d, 41);
        assert.equal(result?.hasTrackRecord, true);
    });

    it("stays null — never 0 — when NO hit carries the aggregates", async () => {
        const search = ok({ hits: hits(25), total: 25 });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.opened90d, null);
        assert.equal(result?.closed90d, null);
        assert.equal(result?.stage, null);
        assert.equal(result?.hasTrackRecord, false);
    });

    it("takes the pair whole from ONE hit — never opened from one document and closed from another", async () => {
        // Two documents, each with half, are two different sync vintages. Pairing
        // them would render a 90-day window that was never simultaneously true.
        const search = ok({
            hits: [
                job({ id: "1", company_opened_90d: 14 }),
                job({ id: "2", company_closed_90d: 9 }),
            ],
            total: 2,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.hasTrackRecord, false);
        assert.equal(result?.opened90d, null);
        assert.equal(result?.closed90d, null);
    });

    it("takes the first COMPLETE hit when several hits carry differing aggregates, and never blends them", async () => {
        const search = ok({
            hits: [
                job({ id: "1" }),
                job({ id: "2", company_opened_90d: 14, company_closed_90d: 9 }),
                job({ id: "3", company_opened_90d: 16, company_closed_90d: 11 }),
            ],
            total: 3,
        });

        const result = await getCompanyPageData("animana--com", search);
        // One document's snapshot, whole: 14/9. Not 14/11, not 16/9 — a mixed
        // pair is the shape that shows a stale number as a current one.
        assert.equal(result?.opened90d, 14);
        assert.equal(result?.closed90d, 9);
        assert.equal(result?.hasTrackRecord, true);
    });

    it("applies the same rule to company_stage — a different field, not a special case", async () => {
        const search = ok({
            hits: [job({ id: "1" }), job({ id: "2", company_stage: "Series C" })],
            total: 2,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.stage, "Series C");
    });

    it("treats a blank company_stage as not carried and keeps looking", async () => {
        const search = ok({
            hits: [
                job({ id: "1", company_stage: "   " }),
                job({ id: "2", company_stage: "Seed" }),
            ],
            total: 2,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.stage, "Seed");
    });
});

describe("getCompanyPageData — internal-only postings never reach the public page", () => {
    it("drops a bracket-tagged internal posting from the roles list", async () => {
        const search = ok({
            hits: [
                job({ id: "1", title: "Senior Backend Engineer" }),
                job({ id: "2", title: "[Internal] Developer, Rust" }),
            ],
            total: 2,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.jobs.length, 1);
        assert.equal(result?.jobs[0]!.id, "1");
    });

    // A differently-worded tag, covering the wiring for the class the
    // predicate matches, not just the one instance that motivated the fix.
    it("drops a second internal-tag phrasing the same way", async () => {
        const search = ok({
            hits: [
                job({ id: "1", title: "Product Manager" }),
                job({ id: "2", title: "[INTERNAL ONLY] Staff Engineer" }),
            ],
            total: 2,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result?.jobs.length, 1);
        assert.equal(result?.jobs[0]!.id, "1");
    });

    it("returns null (never a page of nothing) when every posting is internal-only and no board is tracked", async () => {
        const search = ok({
            hits: [job({ id: "1", title: "[Internal] Developer, Rust" })],
            total: 1,
        });

        const result = await getCompanyPageData("animana--com", search);
        assert.equal(result, null);
    });
});
