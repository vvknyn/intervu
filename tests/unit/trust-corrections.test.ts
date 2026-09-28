import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyTrustCorrections,
    correctCompanyDomain,
    correctSalaryCurrency,
    correctSalaryFromZoneTable,
    detectSalaryCurrencyFromText,
    isForeignCountryTld,
    isCanadaJobContext,
    jobNeedsTrustCorrection,
    listCanadaForeignDomainRisks,
} from "../../src/lib/jobs/trust-corrections";
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

test("TD Canada regression: wrong UK domain remapped to td.com", () => {
    const raw = job({
        company: "The Toronto-Dominion Bank (Canada)",
        company_domain: "tddirectinvesting.co.uk",
        location_country: "Canada",
    });
    assert.equal(correctCompanyDomain(raw), "td.com");
    assert.equal(applyTrustCorrections(raw).company_domain, "td.com");
});

test("TD Canada regression: foreign TLD with CA location_country remaps", () => {
    const raw = job({
        company: "The Toronto-Dominion Bank (Canada)",
        company_domain: "tddirectinvesting.co.uk",
        location_country: "CA",
    });
    assert.equal(correctCompanyDomain(raw), "td.com");
});

test("TD Canada regression: CAD in description overrides stored USD", () => {
    const raw = job({
        salary_min: 81_600,
        salary_max: 115_200,
        salary_currency: "USD",
        description: "Compensation: CAD $81,600–$115,200 per year.",
    });
    assert.equal(detectSalaryCurrencyFromText(raw.description), "CAD");
    assert.equal(correctSalaryCurrency(raw), "CAD");
    assert.equal(applyTrustCorrections(raw).salary_currency, "CAD");
});

test("TD Canada: CAD glued to TD with null salary fields flips USD to CAD", () => {
    const description = "Pay Details:$81,600 - $115,200 CADTD is committed to…";
    assert.equal(detectSalaryCurrencyFromText(description), "CAD");
    const raw = job({
        company: "The Toronto-Dominion Bank (Canada)",
        title: "Software Engineer II",
        salary_min: null,
        salary_max: null,
        salary_currency: "USD",
        description,
    });
    assert.equal(correctSalaryCurrency(raw), "CAD");
    assert.equal(applyTrustCorrections(raw).salary_currency, "CAD");
});

test("does not invent currency when description has no currency marker", () => {
    const raw = job({
        salary_min: 90_000,
        salary_max: 110_000,
        salary_currency: "USD",
        location_country: "Canada",
        description: "Salary range $90,000 to $110,000 annually.",
    });
    assert.equal(detectSalaryCurrencyFromText(raw.description), null);
    assert.equal(correctSalaryCurrency(raw), "USD");
});

test("does not remap unrelated UK companies with .co.uk", () => {
    const raw = job({
        company: "Acme Widgets Ltd.",
        company_domain: "acmewidgets.co.uk",
        location_country: "Canada",
    });
    assert.equal(correctCompanyDomain(raw), "acmewidgets.co.uk");
});

test("does not remap TD when company lacks Canada context", () => {
    const raw = job({
        company: "TD Bank",
        company_domain: "tddirectinvesting.co.uk",
        location_country: "United Kingdom",
    });
    assert.equal(correctCompanyDomain(raw), "tddirectinvesting.co.uk");
});

test("isForeignCountryTld flags UK/DE and spares .com/.ca/.org/.net", () => {
    assert.equal(isForeignCountryTld("tddirectinvesting.co.uk"), true);
    assert.equal(isForeignCountryTld("example.de"), true);
    assert.equal(isForeignCountryTld("td.com"), false);
    assert.equal(isForeignCountryTld("example.ca"), false);
    assert.equal(isForeignCountryTld("example.org"), false);
    assert.equal(isForeignCountryTld("example.net"), false);
});

test("isCanadaJobContext matches company suffix and location_country", () => {
    assert.equal(isCanadaJobContext({ company: "Foo (Canada)", location_country: null }), true);
    assert.equal(isCanadaJobContext({ company: "Foo (Canadian)", location_country: null }), true);
    assert.equal(
        isCanadaJobContext({ company: "Fresenius Medical Care Canada", location_country: null }),
        true,
    );
    assert.equal(
        isCanadaJobContext({ company: "Fresenius Medical Care", location_country: null }),
        false,
    );
    assert.equal(isCanadaJobContext({ company: "Foo", location_country: "Canada" }), true);
    assert.equal(isCanadaJobContext({ company: "Foo", location_country: ["CA", "US"] }), true);
    assert.equal(isCanadaJobContext({ company: "Foo", location_country: "United States" }), false);
});

test("listCanadaForeignDomainRisks includes TD Bank entry", () => {
    const risks = listCanadaForeignDomainRisks();
    assert.ok(risks.some((r) => r.brand.includes("TD Bank")));
    assert.ok(risks.some((r) => r.wrongDomains.includes("tddirectinvesting.co.uk")));
});

test("ambiguous dual-currency description returns null", () => {
    const text =
        "Pay is CAD $90,000 in Toronto and USD $95,000 for US-based staff.";
    assert.equal(detectSalaryCurrencyFromText(text), null);
});

test("TD US: TD Bank, N.A. with UK domain remaps to td.com", () => {
    const raw = job({
        company: "TD Bank, N.A.",
        company_domain: "tddirectinvesting.co.uk",
        location_country: "United States",
    });
    assert.equal(correctCompanyDomain(raw), "td.com");
    assert.equal(applyTrustCorrections(raw).company_domain, "td.com");
});

test("Unity SWE zone table: implausible stored amounts corrected to envelope", () => {
    const description =
        "Base Salary Range: We determine the base salary range for this role based on your primary work location:Zone A: CA$125,300 - CA$175,300 CAD grossZone B: CA$135,400 - CA$203,000 CAD gross";
    const raw = job({
        id: "e15e53ae-02f6-44e5-8a71-549d4115a3d6",
        company: "Unity",
        title: "Senior Software Engineer",
        location_country: "Canada",
        salary_min: 639_400,
        salary_max: 799_300,
        salary_currency: "USD",
        salary_period: null,
        description,
    });
    const corrected = applyTrustCorrections(raw);
    assert.equal(corrected.salary_min, 125_300);
    assert.equal(corrected.salary_max, 203_000);
    assert.equal(corrected.salary_currency, "CAD");
    assert.equal(corrected.salary_period, "year");
    assert.equal(jobNeedsTrustCorrection(raw), true);
});

test("Unity QA zone table: exact Zone A band is left unchanged", () => {
    const description =
        "Base Salary Range: Zone A: CA$103,000 - CA$153,000 CAD grossZone B: CA$111,100 - CA$161,100 CAD gross";
    const raw = job({
        company: "Unity",
        title: "QA Engineer",
        salary_min: 103_000,
        salary_max: 153_000,
        salary_currency: "USD",
        salary_period: "year",
        description,
    });
    const zoneOnly = correctSalaryFromZoneTable(raw);
    assert.equal(zoneOnly.salary_min, 103_000);
    assert.equal(zoneOnly.salary_max, 153_000);
    assert.equal(zoneOnly.salary_period, "year");

    const corrected = applyTrustCorrections(raw);
    assert.equal(corrected.salary_min, 103_000);
    assert.equal(corrected.salary_max, 153_000);
    assert.equal(corrected.salary_period, "year");
    assert.equal(corrected.salary_currency, "CAD");
});

test("no zone table: normal annual range is unchanged", () => {
    const raw = job({
        salary_min: 128_000,
        salary_max: 145_000,
        salary_currency: "USD",
        salary_period: "year",
        description: "Salary range $128,000 to $145,000 annually.",
    });
    const corrected = applyTrustCorrections(raw);
    assert.equal(corrected.salary_min, 128_000);
    assert.equal(corrected.salary_max, 145_000);
    assert.equal(corrected.salary_currency, "USD");
    assert.equal(corrected.salary_period, "year");
    assert.equal(jobNeedsTrustCorrection(raw), false);
});

test("Unity zone table: hourly period is rewritten when amounts are replaced", () => {
    const description =
        "Base Salary Range: Zone A: CA$125,300 - CA$175,300 CAD grossZone B: CA$135,400 - CA$203,000 CAD gross";
    const raw = job({
        salary_min: 639_400,
        salary_max: 799_300,
        salary_currency: "USD",
        salary_period: "hourly",
        description,
    });
    const corrected = applyTrustCorrections(raw);
    assert.equal(corrected.salary_min, 125_300);
    assert.equal(corrected.salary_max, 203_000);
    assert.equal(corrected.salary_period, "year");
});

test("zone table with null description is unchanged (SERP list hit)", () => {
    const raw = job({
        salary_min: 639_400,
        salary_max: 799_300,
        salary_currency: "USD",
        salary_period: null,
        description: null,
    });
    const corrected = applyTrustCorrections(raw);
    assert.equal(corrected.salary_min, 639_400);
    assert.equal(corrected.salary_max, 799_300);
    assert.equal(corrected.salary_currency, "USD");
    assert.equal(corrected.salary_period, null);
    assert.equal(jobNeedsTrustCorrection(raw), false);
});
