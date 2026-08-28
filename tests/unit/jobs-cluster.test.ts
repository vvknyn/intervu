import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clusterJobs, clusterToggleLabel } from "../../src/lib/jobs/cluster";
import type { PublicJob } from "../../src/lib/jobs/types";

let seq = 0;
function job(overrides: Partial<PublicJob> = {}): PublicJob {
    seq += 1;
    return {
        id: `job-${seq}`,
        title: "Senior Product Designer",
        company: "Acme Inc.",
        company_domain: "acme.com",
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://example.com/apply",
        source: "greenhouse",
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

describe("clusterJobs", () => {
    it("passes distinct (title, company) pairs through untouched — no false clustering", () => {
        const jobs = [
            job({ title: "Senior Product Designer", company: "Acme Inc." }),
            job({ title: "Staff Engineer", company: "Acme Inc." }),
            job({ title: "Senior Product Designer", company: "Globex Corp" }),
        ];
        const clusters = clusterJobs(jobs);
        assert.equal(clusters.length, 3);
        assert.deepEqual(clusters.map((c) => c.primary.id), jobs.map((j) => j.id));
        for (const c of clusters) assert.deepEqual(c.variants, []);
    });

    it("merges non-consecutive duplicates (live prod case: same title/company, different locations)", () => {
        const first = job({ title: "Senior Product Designer", company: "Acme Inc.", location_city: "Austin" });
        const other = job({ title: "Staff Engineer", company: "Acme Inc." });
        const dup = job({ title: "Senior Product Designer", company: "Acme Inc.", location_city: "Remote" });
        const clusters = clusterJobs([first, other, dup]);
        assert.equal(clusters.length, 2);
        assert.equal(clusters[0].primary.id, first.id, "best-ranked (earliest) occurrence stays primary");
        assert.deepEqual(clusters[0].variants.map((v) => v.id), [dup.id]);
        assert.equal(clusters[1].primary.id, other.id);
    });

    it("normalizes case/whitespace/company noise the same way the card already does (cleanCompany reuse)", () => {
        const a = job({ title: "Senior Product Designer", company: "Acme Inc." });
        const b = job({ title: "  senior product designer  ", company: "QLYS_CA Acme Inc." });
        const clusters = clusterJobs([a, b]);
        assert.equal(clusters.length, 1, "casing/whitespace/ATS-tenant-prefix noise must not create a false split");
        assert.equal(clusters[0].variants.length, 1);
    });

    it("stable ordering: a cluster anchors at its EARLIEST member's position, never a later duplicate's", () => {
        const jobs = [
            job({ id: "a", title: "Recruiter", company: "Zeta" }),
            job({ id: "b", title: "Senior Product Designer", company: "Acme Inc." }),
            job({ id: "c", title: "Ops Manager", company: "Beta" }),
            job({ id: "d", title: "Senior Product Designer", company: "Acme Inc." }),
        ];
        const clusters = clusterJobs(jobs);
        assert.deepEqual(clusters.map((c) => c.primary.id), ["a", "b", "c"]);
        assert.equal(clusters[1].primaryIndex, 1, "primaryIndex is the FIRST occurrence's index, not the last (3)");
        assert.deepEqual(clusters[1].variants.map((v) => v.id), ["d"]);
    });

    it("never clusters two blank-title jobs together — nothing to compare, so each stays its own card", () => {
        const clusters = clusterJobs([job({ title: "", company: "Acme Inc." }), job({ title: "", company: "Acme Inc." })]);
        assert.equal(clusters.length, 2);
    });

    it("an empty input list produces no clusters", () => {
        assert.deepEqual(clusterJobs([]), []);
    });
});

describe("clusterToggleLabel", () => {
    // Prod bug: 3 distinct ZoomInfo reqs, same title+company+city, rendered
    // "+2 locations" — false, the variants add zero new locations. The pill
    // must read "openings" unless every variant actually adds a distinct,
    // usable location.

    it("all variants add a distinct location → \"+N locations\"", () => {
        const primary = job({ location_city: "Austin" });
        const v1 = job({ location_city: "Remote" });
        const v2 = job({ location_city: "Toronto" });
        assert.equal(clusterToggleLabel(primary, [v1, v2]), "+2 locations");
    });

    it("every variant shares the primary's location (the prod bug case) → \"+N openings\", never \"locations\"", () => {
        const primary = job({ location_city: "Austin" });
        const v1 = job({ location_city: "Austin" });
        const v2 = job({ location_city: "  austin  " }); // same city, casing/whitespace noise
        assert.equal(clusterToggleLabel(primary, [v1, v2]), "+2 openings");
    });

    it("mixed — one variant new, one a repeat of the primary's — still \"openings\" (not partially true)", () => {
        const primary = job({ location_city: "Austin" });
        const newCity = job({ location_city: "Toronto" });
        const sameCity = job({ location_city: "Austin" });
        assert.equal(clusterToggleLabel(primary, [newCity, sameCity]), "+2 openings");
    });

    it("singular phrasing: \"+1 location\" vs \"+1 opening\"", () => {
        const primary = job({ location_city: "Austin" });
        assert.equal(clusterToggleLabel(primary, [job({ location_city: "Toronto" })]), "+1 location");
        assert.equal(clusterToggleLabel(primary, [job({ location_city: "Austin" })]), "+1 opening");
    });

    it("a variant with no usable location never counts as a new one — cluster reads \"openings\"", () => {
        const primary = job({ location_city: "Austin" });
        const unusable = job({ location: null, location_city: null, location_state: null, location_country: null, work_type: "onsite" });
        const distinct = job({ location_city: "Toronto" });
        assert.equal(clusterToggleLabel(primary, [unusable, distinct]), "+2 openings");
    });
});
