import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSalaryAmount, salaryText } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

function job(overrides: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "test",
        title: "Engineer",
        company: "Acme",
        company_domain: "acme.com",
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "unknown",
        description: null,
        employment_type: "unknown",
        experience_level: "unknown",
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

test("normalizeSalaryAmount fixes an extra trailing zero on annual pay", () => {
    assert.equal(normalizeSalaryAmount(1_560_000, "year"), 156_000);
    assert.equal(normalizeSalaryAmount(1_800_000, "year"), 180_000);
});

test("normalizeSalaryAmount leaves plausible six-figure annual pay alone", () => {
    assert.equal(normalizeSalaryAmount(600_000, "year"), 600_000);
    assert.equal(normalizeSalaryAmount(1_200_000, "year"), 1_200_000);
});

test("normalizeSalaryAmount does not touch hourly rates", () => {
    assert.equal(normalizeSalaryAmount(1_560_000, "hour"), 1_560_000);
});

test("salaryText renders corrected Limble-style ranges", () => {
    assert.equal(
        salaryText(
            job({
                salary_min: 1_560_000,
                salary_max: 1_800_000,
                salary_currency: "USD",
                salary_period: "year",
            }),
        ),
        "USD 156k–180k/yr",
    );
});

test("salaryText leaves normal annual ranges unchanged", () => {
    assert.equal(
        salaryText(
            job({
                salary_min: 128_000,
                salary_max: 145_000,
                salary_currency: "USD",
                salary_period: "year",
            }),
        ),
        "USD 128k–145k/yr",
    );
});

test("salaryText returns null when pay is missing", () => {
    assert.equal(salaryText(job({})), null);
});
