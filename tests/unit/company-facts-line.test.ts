import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyFacts } from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * `buildCompanyFacts`'s hero fact row: `{ domain, hiringGeos, remoteShare }`.
 * Covers the parts the function has to get right independently — a normal
 * multi-country case, junk/empty `location_country` tokens dropped from both
 * the shown names and the "+N more" count, an all-junk roster omitting the
 * clause entirely (`null`, not an empty string), and an absent remote-share
 * input omitting its own field without disturbing the others.
 */

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: "acme.example",
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

function pageData(jobs: PublicJob[], remotePct: number | null): Pick<CompanyPageData, "domain" | "jobs" | "intelligence"> {
  return {
    domain: "acme.example",
    jobs,
    intelligence:
      remotePct == null
        ? undefined
        : {
            funding: null,
            visa: null,
            techStack: null,
            workModes: { remotePct, hybridPct: 0, onsitePct: 0 },
            news: [],
          },
  };
}

test("normal case — domain, top hiring countries by role count, and remote share all present", () => {
  const jobs = [
    job({ id: "1", location_country: "United States" }),
    job({ id: "2", location_country: "United States" }),
    job({ id: "3", location_country: "Canada" }),
    job({ id: "4", location_country: "India" }),
    job({ id: "5", location_country: "Germany" }),
  ];
  const facts = buildCompanyFacts(pageData(jobs, 42));
  assert.deepEqual(facts, {
    domain: "acme.example",
    hiringGeos: "hiring in United States, Canada, India +1 more",
    remoteShare: "42% of roles remote",
  });
});

test("junk/empty location_country tokens are skipped — city/remote-sentinel noise never displaces a real country or inflates the '+N more' count", () => {
  const jobs = [
    job({ id: "1", location_country: "United States" }),
    job({ id: "2", location_country: "San Francisco" }), // city, not a country
    job({ id: "3", location_country: "" }), // blank token
    job({ id: "4", location_country: "Multiple Locations" }), // pollution
  ];
  const facts = buildCompanyFacts(pageData(jobs, 10));
  assert.equal(facts.hiringGeos, "hiring in United States");
  assert.equal(facts.remoteShare, "10% of roles remote");
});

test("zero usable countries — hiringGeos is null, not an empty string", () => {
  const jobs = [
    job({ id: "1", location_country: "Bengaluru" }),
    job({ id: "2", location_country: null }),
  ];
  const facts = buildCompanyFacts(pageData(jobs, 25));
  assert.equal(facts.hiringGeos, null);
  assert.equal(facts.remoteShare, "25% of roles remote");
});

test("remote share absent — remoteShare is null while domain and hiringGeos still resolve", () => {
  const facts = buildCompanyFacts(pageData([job({ id: "1", location_country: "France" })], null));
  assert.deepEqual(facts, {
    domain: "acme.example",
    hiringGeos: "hiring in France",
    remoteShare: null,
  });
});

test("nothing but the domain — both hiringGeos and remoteShare are null", () => {
  const facts = buildCompanyFacts(pageData([], null));
  assert.deepEqual(facts, { domain: "acme.example", hiringGeos: null, remoteShare: null });
});
