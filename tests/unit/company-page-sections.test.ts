import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanyFacts, type CompanyFacts } from "@/lib/companies/company-facts";
import { companySections, SECTION_ORDER } from "@/lib/companies/company-sections";
import { buildCompanyFaq } from "@/lib/companies/company-faq";
import { buildRelatedCompanies, RELATED_LIMIT } from "@/lib/companies/related-companies";
import { careerHubPathFor } from "@/lib/companies/hub-link";
import type { PublicJob } from "@/lib/jobs/types";

const job = (id: string): PublicJob =>
  ({ id, title: "Engineer", company: "Acme", company_domain: "acme.com", location_country: "United States", work_type: "remote", posted_at: "2026-10-01T00:00:00Z", salary_min: 100, salary_max: 120, tags: [], vacancy_status: "open" }) as unknown as PublicJob;

const full = (): CompanyFacts =>
  buildCompanyFacts({
    name: "Acme", domain: "acme.com", jobs: [job("1")], openCount: { value: 1240, isLowerBound: false }, postingTotal: 1240,
    ghostFlaggedPct: 4,
    facetDistribution: { location_country: { "United States": 900, Canada: 100 }, work_type: { remote: 300, onsite: 940 }, visa_sponsorship: { true: 20, false: 80 }, tech_stack: { React: 312 } },
  });
const empty = (): CompanyFacts => buildCompanyFacts({ name: "Zed", domain: "zed.com", jobs: [], openCount: { value: 0, isLowerBound: false }, postingTotal: 0 });
const extras = { roleCount: 1, relatedCount: 2, faqCount: 3 };

describe("SECTION_ORDER", () => {
  it("puts the open roles right after the hiring facts", () => {
    assert.deepEqual(
      [...SECTION_ORDER],
      ["identity", "hiringNow", "openRoles", "whereAndHow", "skills", "listingHealth", "filings", "related", "faq"],
    );
  });
});

describe("companySections", () => {
  it("a full company states every section, in page order", () => {
    const f = full();
    const ids = companySections(f, extras);
    assert.deepEqual(ids, SECTION_ORDER.filter((i: string) => i !== "filings"));
    assert.ok(!ids.includes("filings"), "no filing records fed, so none stated");
  });
  it("a zero-facet company is identity alone", () => {
    assert.deepEqual(companySections(empty(), { roleCount: 0, relatedCount: 0, faqCount: 0 }), ["identity"]);
  });
  it("profile but no pay: whereAndHow exists from the mix, and no pay is stated", () => {
    const f = full();
    const noPay = { ...f, pay: null };
    assert.equal(noPay.pay, null);
    assert.ok(companySections(noPay, extras).includes("whereAndHow"));
    const onlyPay = { ...empty(), pay: { typical: "$1", roles: 1, scope: "US roles listing pay" as const } };
    assert.ok(companySections(onlyPay, { roleCount: 0, relatedCount: 0, faqCount: 0 }).includes("whereAndHow"));
  });
});

describe("buildCompanyFaq", () => {
  it("turns the numbers into sentences", () => {
    const faq = buildCompanyFaq(full());
    assert.equal(faq.length, 5);
    assert.match(faq[0].answer, /1,240 open roles/);
    assert.match(faq.find((q) => /remote/.test(q.question))!.answer, /300 of 1,240 listings that state a work mode/);
    assert.match(faq.find((q) => /visas/.test(q.question))!.answer, /20 of 100/);
  });
  it("omits questions without data", () => {
    const faq = buildCompanyFaq(empty());
    assert.deepEqual(faq.map((q) => q.question), ["Is Zed hiring?"]);
  });
});

describe("buildRelatedCompanies", () => {
  const dir = (domain: string, openRoleCount: number) => ({ domain, openRoleCount, computedAt: null });
  const set = [dir("a.com", 50), dir("b.com", 90), dir("c.com", 90), dir("self.com", 500), dir("x.com", 40)];
  it("excludes itself and non-indexable candidates, ranks by roles then domain", () => {
    const out = buildRelatedCompanies(["a.com", "b.com", "c.com", "self.com", "outside.com"], set, "self.com");
    assert.deepEqual(out.map((c) => c.domain), ["b.com", "c.com", "a.com"]);
  });
  it("ranks by shared hits before open roles, counting repeated hit domains", () => {
    const out = buildRelatedCompanies(["small.io", "small.io", "small.io", "giant.com"], [dir("giant.com", 9000), dir("small.io", 12)], "self.com");
    assert.deepEqual(out.map((c) => c.domain), ["small.io", "giant.com"]);
  });
  it("falls back to open roles when hit counts tie", () => {
    const out = buildRelatedCompanies(["p.io", "q.io"], [dir("p.io", 5), dir("q.io", 80)], "self.com");
    assert.deepEqual(out.map((c) => c.domain), ["q.io", "p.io"]);
  });
  it("caps at six", () => {
    const many = Array.from({ length: 12 }, (_, i) => dir(`d${i}.com`, i));
    assert.equal(buildRelatedCompanies(many.map((m) => m.domain), many, "none.com").length, RELATED_LIMIT);
  });
});

describe("careerHubPathFor", () => {
  it("links a value only when a hub exists", () => {
    assert.equal(careerHubPathFor("Software Engineer"), "/careers/software-engineer-jobs");
    assert.equal(careerHubPathFor("Haskell"), null);
  });
});
