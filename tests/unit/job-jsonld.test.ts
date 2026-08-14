process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://intervuhq.com";

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobPostingJsonLd } from "../../src/lib/seo/jsonld";
import type { PublicJob } from "../../src/lib/jobs/types";

// Cast once, here, rather than at every call site below: `base` deliberately
// omits fields PublicJob requires that this builder never reads, and casting
// through `never` at each spread site trips TS2698 (spread of `never`).
const base = {
  id: "f7357d0c-fae4-4f2e-a850-c46d991efba3",
  title: "Data Engineer",
  company: "Orange",
  description: "Build pipelines.",
  posted_at: "2026-08-09T04:15:36+00:00",
  location: "Warszawa, Poland",
  location_country: "Poland",
  work_type: "onsite",
  employment_type: "full_time",
  vacancy_status: "active",
} as unknown as PublicJob;

test("emits a JobPosting with the required schema.org fields", () => {
  const ld = buildJobPostingJsonLd(base, "/jobs/data-engineer-at-orange-f7357d0c-fae4-4f2e-a850-c46d991efba3");
  assert.equal(ld["@type"], "JobPosting");
  assert.equal(ld.title, "Data Engineer");
  assert.equal(ld.hiringOrganization.name, "Orange");
  assert.equal(ld.datePosted, "2026-08-09T04:15:36+00:00");
  assert.equal(ld.directApply, false);
  assert.equal(ld.identifier?.value, "f7357d0c-fae4-4f2e-a850-c46d991efba3");
});

test("omits absent fields rather than emitting null or a placeholder", () => {
  const ld = buildJobPostingJsonLd({ ...base, description: null, posted_at: null }, "/jobs/x");
  assert.ok(!("description" in ld), "description must be omitted, not null");
  assert.ok(!("datePosted" in ld), "datePosted must be omitted, not null");
});

test("handles a multi-country posting (location_country as array)", () => {
  const ld = buildJobPostingJsonLd({ ...base, location_country: ["Poland", "Norway"] }, "/jobs/x");
  assert.ok(Array.isArray(ld.jobLocation));
  assert.equal(ld.jobLocation!.length, 2);
});

test("sets validThrough on a closed vacancy so Google de-indexes it", () => {
  const ld = buildJobPostingJsonLd(
    { ...base, vacancy_status: "closed", updated_at: "2026-08-01T00:00:00+00:00" },
    "/jobs/x",
  );
  assert.equal(ld.validThrough, "2026-08-01T00:00:00+00:00");
});

test("maps every known facet employment type to a schema.org enum value", () => {
  for (const [input, expected] of [
    ["full_time", "FULL_TIME"],
    ["contract", "CONTRACTOR"],
    ["part_time", "PART_TIME"],
    ["internship", "INTERN"],
  ] as const) {
    const ld = buildJobPostingJsonLd({ ...base, employment_type: input }, "/jobs/x");
    assert.equal(ld.employmentType, expected, `${input} should map to ${expected}`);
  }
});

test("emits TELECOMMUTE jobLocationType for remote postings", () => {
  const ld = buildJobPostingJsonLd({ ...base, work_type: "remote" }, "/jobs/x");
  assert.equal(ld.jobLocationType, "TELECOMMUTE");
  assert.ok(Array.isArray(ld.applicantLocationRequirements));
});

test("emits structured baseSalary when salary ranges exist", () => {
  const ld = buildJobPostingJsonLd(
    {
      ...base,
      salary_min: 120000,
      salary_max: 150000,
      salary_currency: "USD",
      salary_period: "year",
    },
    "/jobs/x",
  );
  assert.ok(ld.baseSalary);
  assert.equal(ld.baseSalary?.currency, "USD");
  assert.equal(ld.baseSalary?.value.minValue, 120000);
  assert.equal(ld.baseSalary?.value.maxValue, 150000);
  assert.equal(ld.baseSalary?.value.unitText, "YEAR");
});

