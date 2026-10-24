import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanyFacts, buildDistribution, type CompanyFactsInput } from "@/lib/companies/company-facts";
import type { CompanyExhaust, ExhaustSection } from "@/lib/companies/exhaust";
import type { PublicJob } from "@/lib/jobs/types";

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
    return {
        title: "Engineer",
        company: "Acme",
        company_domain: "acme.com",
        location: null,
        location_city: null,
        location_state: null,
        location_country: "United States",
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

function paid(id: string, country: string, min: number, max: number): PublicJob {
    return job({ id, location_country: country, salary_min: min, salary_max: max, salary_currency: "USD", salary_period: "year" });
}

function section<T>(data: T, asOf = "2026-04-25T00:00:00Z"): ExhaustSection<T> {
    return { data, source: "s", label: "l", asOf };
}

function exhaust(overrides: Partial<CompanyExhaust> = {}): CompanyExhaust {
    return {
        profile: null, funding: null, secListing: null, govContracts: null, h1bLca: null, warnNotices: null,
        health: null, cadence: null, integrity: null, techStack: null, changeHistory: null, sector: null,
        ...overrides,
    };
}

function input(overrides: Partial<CompanyFactsInput> = {}): CompanyFactsInput {
    return {
        name: "Acme",
        domain: "acme.com",
        jobs: [],
        openCount: { value: 0, isLowerBound: false },
        trackRecord: null,
        ghostFlaggedPct: null,
        facetDistribution: undefined,
        exhaust: null,
        ...overrides,
    };
}

describe("buildDistribution", () => {
    it("drops unknown/blank values, keeps stated and total honest", () => {
        const d = buildDistribution({ remote: 6, hybrid: 2, unknown: 9, "": 1, Unknown: 1 }, 19);
        assert.deepEqual(d, { buckets: [{ value: "remote", count: 6 }, { value: "hybrid", count: 2 }], stated: 8, total: 19 });
    });
    it("is null when nothing is stated", () => {
        assert.equal(buildDistribution({ unknown: 4 }, 4), null);
        assert.equal(buildDistribution(undefined, 4), null);
    });
    it("multi-valued facets carry stated=null (a per-role count is not recoverable) and honour the limit", () => {
        const d = buildDistribution({ a: 5, b: 4, c: 3 }, 9, { multiValued: true, limit: 2 });
        assert.deepEqual(d, { buckets: [{ value: "a", count: 5 }, { value: "b", count: 4 }], stated: null, total: 9 });
    });
});

describe("buildCompanyFacts", () => {
    it("a company with no facets and no box data: every section null, no throw", () => {
        const f = buildCompanyFacts(input());
        assert.equal(f.identity.sector, null);
        assert.equal(f.identity.profile, null);
        assert.equal(f.identity.profileSource, null);
        assert.equal(f.hiring.lastPostedAt, null);
        assert.equal(f.hiring.cadence, null);
        assert.equal(f.mix.countries, null);
        assert.equal(f.mix.workType, null);
        assert.equal(f.mix.visaSponsorship, null);
        assert.equal(f.mix.skills, null);
        assert.equal(f.pay, null);
        assert.equal(f.health.verdict, null);
    });

    it("full company: distributions come from the facet result over ALL roles, not the fetched window", () => {
        const f = buildCompanyFacts(
            input({
                openCount: { value: 1240, isLowerBound: false },
                jobs: [job({ id: "1", posted_at: "2026-10-01T00:00:00Z", posted_ts: Date.parse("2026-10-01T00:00:00Z"), last_observed_alive_at: "2026-10-20T00:00:00Z" })],
                trackRecord: { opened90d: 40, closed90d: 12 },
                facetDistribution: {
                    work_type: { remote: 700, hybrid: 100, unknown: 440 },
                    visa_sponsorship: { true: 30, false: 70 },
                    location_country: { "United States": 900, USA: 50, Berlin: 3 },
                    must_have_skills: { python: 800, go: 400 },
                },
            }),
        );
        assert.equal(f.hiring.openCount, 1240);
        assert.equal(f.hiring.opened90d, 40);
        assert.equal(f.hiring.lastPostedAt, "2026-10-01T00:00:00Z");
        assert.equal(f.hiring.lastSeenAliveAt, "2026-10-20T00:00:00Z");
        assert.deepEqual(f.mix.workType, { buckets: [{ value: "remote", count: 700 }, { value: "hybrid", count: 100 }], stated: 800, total: 1240 });
        assert.deepEqual(f.mix.visaSponsorship, { sponsors: 30, stated: 100, total: 1240 });
        assert.deepEqual(f.mix.countries?.buckets, [{ value: "United States", count: 950 }]);
        assert.equal(f.mix.skills, null, "the unstamped fetched role names no evidenced skill, whatever the facet says");
    });

    it("skills: only evidenced lists count, once per role, over the fetched window", () => {
        const stamped = (id: string, skills: string[]) => job({ id, must_have_skills: skills, skills_section_found: true });
        const f = buildCompanyFacts(
            input({
                jobs: [stamped("1", ["python", "go", "go"]), stamped("2", ["python"]), job({ id: "3", must_have_skills: ["cobol"] })],
                openCount: { value: 500, isLowerBound: false },
            }),
        );
        assert.deepEqual(f.mix.skills, { buckets: [{ value: "python", count: 2 }, { value: "go", count: 1 }], stated: null, total: 3 });
    });

    it("pay: US-located roles only, scope labelled; a non-US role is excluded", () => {
        const jobs = [
            paid("1", "United States", 100000, 120000),
            paid("2", "United States", 110000, 130000),
            paid("3", "United States", 120000, 140000),
            paid("4", "India", 1000, 2000),
            job({ id: "5" }),
        ];
        const f = buildCompanyFacts(input({ jobs }));
        assert.equal(f.pay?.scope, "US roles listing pay");
        assert.equal(f.pay?.roles, 3);
        assert.match(f.pay?.typical ?? "", /^USD 1\d\dk/);
        assert.doesNotMatch(f.pay?.typical ?? "", /1k|2k/);
    });

    it("pay is null when no US role lists pay", () => {
        assert.equal(buildCompanyFacts(input({ jobs: [paid("1", "India", 1000, 2000)] })).pay, null);
    });

    it("profile present: fields + source only when present", () => {
        const profile = section({
            tagline: "We build things", homepageUri: null, hqCountry: "US", industries: ["Fintech"], yearFounded: 2011,
            organizationType: null, nbEmployees: "201-500", parentCompany: null, atsHint: "greenhouse", totalJobs: null,
        });
        const f = buildCompanyFacts(input({ exhaust: exhaust({ profile }) }));
        assert.deepEqual(f.identity.profile, { tagline: "We build things", yearFounded: 2011, employees: "201-500", hqCountry: "US", industries: ["Fintech"] });
        assert.deepEqual(f.identity.profileSource, { domain: "hiring.cafe", fetchedAt: "2026-04-25T00:00:00Z" });
        assert.equal(f.identity.atsProvider, "greenhouse");
    });

    it("profile row with no usable field is absent, with no source", () => {
        const profile = section({
            tagline: null, homepageUri: "https://x", hqCountry: null, industries: [], yearFounded: null,
            organizationType: null, nbEmployees: null, parentCompany: null, atsHint: null, totalJobs: null,
        });
        const f = buildCompanyFacts(input({ exhaust: exhaust({ profile }) }));
        assert.equal(f.identity.profile, null);
        assert.equal(f.identity.profileSource, null);
    });

    it("sector comes from the box's one resolver", () => {
        assert.equal(buildCompanyFacts(input({ exhaust: exhaust({ sector: "Fintech" }) })).identity.sector, "Fintech");
        assert.equal(buildCompanyFacts(input()).identity.sector, null);
    });
});
