import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveWorkModeDistribution } from "@/lib/companies/enrichment";
import { buildCompanyFacts } from "@/lib/companies/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * `buildCompanyFacts`'s hero fact row: `{ domain, hiringGeos, remoteShare, remoteJobsUrl }`.
 * Covers the parts the function has to get right independently — a normal
 * multi-country case, junk/empty `location_country` tokens dropped from both
 * the shown names and the "+N more" count, an all-junk roster omitting the
 * clause entirely (`null`, not an empty string), and an absent remote-share
 * input omitting its own field without disturbing the others. The remote
 * fact is a count by the /jobs Remote filter's `work_type` rule when the
 * fetched roles are all of them, a rounded share over a sample, and links to
 * that filtered search.
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

type FactsInput = Parameters<typeof buildCompanyFacts>[0];

/** Work modes are derived from the same jobs, as get-company.ts does. */
function pageData(
  jobs: PublicJob[],
  { openCount = jobs.length, openCountIsLowerBound = false, withModes = true } = {},
): FactsInput {
  const workModes = withModes ? deriveWorkModeDistribution(jobs) : null;
  return {
    domain: "acme.example",
    jobs,
    openCount,
    openCountIsLowerBound,
    intelligence: workModes ? { funding: null, visa: null, techStack: null, workModes, news: [] } : undefined,
  };
}

const onsite = { work_type: "onsite" } as const;

test("normal case — domain, top hiring countries by role count, and the remote count all present", () => {
  const jobs = [
    job({ id: "1", location_country: "United States" }),
    job({ id: "2", location_country: "United States", ...onsite }),
    job({ id: "3", location_country: "Canada", ...onsite }),
    job({ id: "4", location_country: "India", ...onsite }),
    job({ id: "5", location_country: "Germany", ...onsite }),
  ];
  const facts = buildCompanyFacts(pageData(jobs));
  assert.equal(facts.domain, "acme.example");
  assert.equal(facts.hiringGeos, "hiring in United States, Canada, India +1 more");
  assert.equal(facts.remoteShare, "1 of 5 roles remote");
});

test("a title or location saying 'remote' is not a remote role — only work_type counts, as on the /jobs Remote filter", () => {
  const jobs = [
    job({ id: "1", title: "Remote Sensing Engineer", ...onsite }),
    job({ id: "2", location: "Remote-friendly office, Austin", ...onsite }),
    job({ id: "3", work_type: "Remote" }),
  ];
  assert.equal(buildCompanyFacts(pageData(jobs)).remoteShare, "1 of 3 roles remote");
});

test("the remote fact links to this company's roles with the Remote filter, using the work_type values the roles carry", () => {
  const jobs = [job({ id: "1", work_type: "Remote" }), job({ id: "2", ...onsite })];
  const url = buildCompanyFacts(pageData(jobs)).remoteJobsUrl;
  assert.ok(url?.startsWith("/jobs?"), String(url));
  const params = new URLSearchParams(url!.slice("/jobs?".length));
  assert.ok([...params.values()].some((v) => v.split(",").includes("Remote")), url!);
  assert.ok([...params.values()].some((v) => v.includes("acme.example")), url!);
});

test("over a sample (open count is a floor) the remote fact is an approximate share, not a count", () => {
  const jobs = [job({ id: "1" }), job({ id: "2", ...onsite }), job({ id: "3", ...onsite }), job({ id: "4", ...onsite })];
  const facts = buildCompanyFacts(pageData(jobs, { openCount: 200, openCountIsLowerBound: true }));
  assert.equal(facts.remoteShare, "about 25% of roles remote");
});

test("over a sample with no remote roles, the remote fact is dropped rather than stated as none", () => {
  const jobs = [job({ id: "1", ...onsite }), job({ id: "2", ...onsite })];
  const facts = buildCompanyFacts(pageData(jobs, { openCount: 200, openCountIsLowerBound: true }));
  assert.equal(facts.remoteShare, null);
  assert.equal(facts.remoteJobsUrl, null);
});

test("every role fetched and none remote — the count says so and there is nothing to link", () => {
  const facts = buildCompanyFacts(pageData([job({ id: "1", ...onsite }), job({ id: "2", ...onsite })]));
  assert.equal(facts.remoteShare, "0 of 2 roles remote");
  assert.equal(facts.remoteJobsUrl, null);
});

test("junk/empty location_country tokens are skipped — city/remote-sentinel noise never displaces a real country or inflates the '+N more' count", () => {
  const jobs = [
    job({ id: "1", location_country: "United States" }),
    job({ id: "2", location_country: "San Francisco" }), // city, not a country
    job({ id: "3", location_country: "" }), // blank token
    job({ id: "4", location_country: "Multiple Locations" }), // pollution
  ];
  const facts = buildCompanyFacts(pageData(jobs));
  assert.equal(facts.hiringGeos, "hiring in United States");
});

test("zero usable countries — hiringGeos is null, not an empty string", () => {
  const jobs = [
    job({ id: "1", location_country: "Bengaluru" }),
    job({ id: "2", location_country: null }),
  ];
  const facts = buildCompanyFacts(pageData(jobs));
  assert.equal(facts.hiringGeos, null);
  assert.equal(facts.remoteShare, "2 of 2 roles remote");
});

test("remote share absent — remoteShare is null while domain and hiringGeos still resolve", () => {
  const facts = buildCompanyFacts(pageData([job({ id: "1", location_country: "France" })], { withModes: false }));
  assert.deepEqual(facts, {
    domain: "acme.example",
    hiringGeos: "hiring in France",
    remoteShare: null,
    remoteJobsUrl: null,
  });
});

test("nothing but the domain — both hiringGeos and remoteShare are null", () => {
  const facts = buildCompanyFacts(pageData([]));
  assert.deepEqual(facts, { domain: "acme.example", hiringGeos: null, remoteShare: null, remoteJobsUrl: null });
});
