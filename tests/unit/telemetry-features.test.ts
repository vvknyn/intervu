import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJobFeatures, extractJobFeaturesBatch } from "../../src/lib/telemetry/features";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-09-03T12:00:00Z");

// Fixture-factory pattern reused from tests/unit/company-stats.test.ts:9 —
// the same PublicJob the job-detail page renders (src/lib/jobs/types.ts:30).
function job(overrides: Partial<PublicJob>): PublicJob {
  return {
    id: overrides.id ?? Math.random().toString(36),
    title: "Software Engineer",
    company: "Acme Corp",
    company_domain: "acme.com",
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
    source: "greenhouse_direct",
    posted_at: null,
    first_seen_at: null,
    posted_ts: null,
    updated_at: null,
    vacancy_status: "active",
    ghost_badge: "unscored",
    ...overrides,
  };
}

// A benefits heading present with ZERO enumerable items underneath it (no
// list follows the heading — only prose). Preceded by a bulleted list
// (not a period-ending sentence) so format-description.ts's own
// promoteHeadings() doesn't fold the isolated "Benefits:" heading back
// into the following prose paragraph — that fold only triggers when a
// short label heading directly follows a "[.!?]\s+"-terminated sentence,
// verified by hand against src/lib/jobs/format-description.ts. Long
// enough (>220 chars) to clear descriptionNeedsFill's teaser threshold.
const BENEFITS_SECTION_ZERO_ITEMS = `
## About the role
We are looking for a Software Engineer to join our team and help us build reliable systems that our customers depend on every single day of the year.

## Responsibilities
- Design and build backend services
- Own the on-call rotation

## Benefits
We offer a comprehensive package described during the interview process, tailored to your specific circumstances and negotiated individually with each candidate we make an offer to.
`.trim();

// A complete (non-teaser) description with no benefits/perks/compensation
// heading at all — the genuinely-not-stated case, distinct from the
// teaser-truncation NULL case already covered above. Also exercises a
// second numeric count field (requirement_count) touched by the same
// sweep: "## Requirements" here is followed by prose, not a list, so
// requirement_count must report the real 0, not null — same class of bug
// as benefit_count, on a sibling field that was already correct.
const REQUIREMENTS_HEADING_ZERO_ITEMS = `
## About the role
We are looking for a Software Engineer to join our growing team and help us ship reliable products for our customers around the world every single day without exception whatsoever this year.

## Responsibilities
- Design and build backend services
- Own the on-call rotation

## Requirements
We discuss specific requirements individually with each candidate during the interview loop depending on role and level globally.
`.trim();

const FULL_DESCRIPTION = `
## About the role
We are looking for a Senior Software Engineer to join our growing team.

## Responsibilities
- Design and build backend services
- Own the on-call rotation
- Mentor junior engineers

## Requirements
- 5+ years of experience
- Bachelor's degree in Computer Science
- Strong knowledge of TypeScript and PostgreSQL

## Nice to have
- Experience with Kubernetes

## Benefits
- Health insurance
- 401k match
- Equity grant (RSUs)

We are an equal opportunity employer. Visa sponsorship is available for this role.
`.trim();

describe("extractJobFeatures — NULL discipline", () => {
  it("a posting with no salary yields has_salary=false and NULL salary fields, not 0", () => {
    const features = extractJobFeatures(job({ salary_min: null, salary_max: null }), NOW);
    assert.equal(features.has_salary, false);
    assert.equal(features.salary_min, null);
    assert.equal(features.salary_max, null);
    assert.equal(features.salary_span_pct, null);
  });

  it("a posting with salary yields the range and a computed span", () => {
    const features = extractJobFeatures(
      job({ salary_min: 100_000, salary_max: 150_000 }),
      NOW,
    );
    assert.equal(features.has_salary, true);
    assert.equal(features.salary_min, 100_000);
    assert.equal(features.salary_max, 150_000);
    assert.equal(features.salary_span_pct, 50); // (150k - 100k) / 100k * 100
  });

  it("a one-sided salary (min only) is has_salary=true but span stays NULL, not 0", () => {
    const features = extractJobFeatures(job({ salary_min: 100_000, salary_max: null }), NOW);
    assert.equal(features.has_salary, true);
    assert.equal(features.salary_span_pct, null);
  });

  it("two postings differing only in has_salary produce different rows", () => {
    const withSalary = extractJobFeatures(job({ salary_min: 90_000, salary_max: 110_000 }), NOW);
    const withoutSalary = extractJobFeatures(job({ salary_min: null, salary_max: null }), NOW);
    assert.notEqual(withSalary.has_salary, withoutSalary.has_salary);
    assert.notEqual(withSalary.salary_min, withoutSalary.salary_min);
  });

  it("a teaser/truncated description yields NULL for every description-derived field, not 0/false", () => {
    // descriptionNeedsFill's own teaser heuristic: very short, unterminated text.
    const features = extractJobFeatures(job({ description: "We are hiring for a" }), NOW);
    assert.equal(features.description_chars, null);
    assert.equal(features.bullet_count, null);
    assert.equal(features.section_count, null);
    assert.equal(features.has_equity_mention, null);
    assert.equal(features.has_benefits_section, null);
    assert.equal(features.degree_required, null);
  });

  it("a complete description yields real structural counts, not null", () => {
    const features = extractJobFeatures(job({ description: FULL_DESCRIPTION }), NOW);
    assert.ok(typeof features.description_chars === "number" && features.description_chars > 0);
    assert.equal(features.has_equity_mention, true);
    assert.equal(features.has_benefits_section, true);
    assert.equal(features.has_visa_statement, true);
    assert.equal(features.has_eeo_boilerplate, true);
    assert.equal(features.has_nice_to_have_section, true);
    assert.equal(features.degree_level, "bachelor");
  });
});

describe("extractJobFeatures — measured-zero vs not-stated NULL discipline on count fields", () => {
  it("a benefits section present with zero enumerable items yields benefit_count=0, not null", () => {
    const features = extractJobFeatures(job({ description: BENEFITS_SECTION_ZERO_ITEMS }), NOW);
    assert.equal(features.has_benefits_section, true);
    assert.equal(features.benefit_count, 0);
  });

  it("no benefits/perks/compensation heading at all yields benefit_count=null (has_benefits_section=false) — no regression", () => {
    const features = extractJobFeatures(job({ description: REQUIREMENTS_HEADING_ZERO_ITEMS }), NOW);
    assert.equal(features.has_benefits_section, false);
    assert.equal(features.benefit_count, null);
  });

  it("a complete description with real benefit bullets still reports the true positive count", () => {
    const features = extractJobFeatures(job({ description: FULL_DESCRIPTION }), NOW);
    assert.equal(features.benefit_count, 3); // Health insurance / 401k match / Equity grant
  });

  it("sibling field from the same sweep: a Requirements heading present with zero list items yields requirement_count=0, not null", () => {
    const features = extractJobFeatures(job({ description: REQUIREMENTS_HEADING_ZERO_ITEMS }), NOW);
    assert.equal(features.requirement_count, 0);
  });
});

describe("extractJobFeatures — structural facts", () => {
  it("title fields are always populated (never null) since title is always present", () => {
    const features = extractJobFeatures(job({ title: "Staff Backend Engineer" }), NOW);
    assert.equal(features.title_chars, "Staff Backend Engineer".length);
    assert.equal(features.title_word_count, 3);
    assert.equal(features.seniority_word, "Staff");
  });

  it("is_remote/is_hybrid/is_onsite are all NULL when work_type is 'unknown', not false", () => {
    const features = extractJobFeatures(job({ work_type: "unknown" }), NOW);
    assert.equal(features.is_remote, null);
    assert.equal(features.is_hybrid, null);
    assert.equal(features.is_onsite, null);
  });

  it("work_type resolves to exactly one true flag when stated", () => {
    const features = extractJobFeatures(job({ work_type: "hybrid" }), NOW);
    assert.equal(features.is_remote, false);
    assert.equal(features.is_hybrid, true);
    assert.equal(features.is_onsite, false);
  });
});

describe("extractJobFeatures — apply_method / ats_provider (structural, no enumeration)", () => {
  it("a '<provider>_direct' source splits into apply_method + ats_provider", () => {
    const features = extractJobFeatures(job({ source: "workday_direct" }), NOW);
    assert.equal(features.apply_method, "workday");
    assert.equal(features.ats_provider, "workday");
  });

  it("a bare 'direct' source has no ats_provider and apply_method is the literal 'direct'", () => {
    const features = extractJobFeatures(job({ source: "direct" }), NOW);
    assert.equal(features.apply_method, "direct");
    assert.equal(features.ats_provider, null);
  });

  it("a previously-unseen provider suffix is still parsed correctly (structural rule, not a lookup table)", () => {
    const features = extractJobFeatures(job({ source: "some_brand_new_ats_direct" }), NOW);
    assert.equal(features.apply_method, "some_brand_new_ats");
    assert.equal(features.ats_provider, "some_brand_new_ats");
  });
});

describe("extractJobFeatures — repost_count / days_open", () => {
  it("repost_count is always NULL (no cross-job matching pass exists), never fabricated to 0", () => {
    const features = extractJobFeatures(job({}), NOW);
    assert.equal(features.repost_count, null);
  });

  it("days_open is computed from first_seen_at when present", () => {
    const firstSeen = new Date(NOW - 5 * 86_400_000).toISOString();
    const features = extractJobFeatures(job({ first_seen_at: firstSeen }), NOW);
    assert.equal(features.days_open, 5);
  });

  it("days_open is NULL when first_seen_at is absent, not 0", () => {
    const features = extractJobFeatures(job({ first_seen_at: null }), NOW);
    assert.equal(features.days_open, null);
  });
});

describe("extractJobFeaturesBatch — skips incomplete docs instead of crashing", () => {
  const full = job({ id: "full" });

  it("skips an id-only doc missing source and still extracts the full doc", () => {
    const { features, skipped } = extractJobFeaturesBatch([{ id: "stub" }, full], NOW);
    assert.equal(skipped, 1);
    assert.deepEqual(features.map((f) => f.job_id), ["full"]);
  });

  it("skips a doc missing a different required field (title)", () => {
    const { title: _t2, ...withSourceNoTitle } = full;
    const { features, skipped } = extractJobFeaturesBatch([withSourceNoTitle, full], NOW);
    assert.equal(skipped, 1);
    assert.equal(features.length, 1);
  });

  it("skips a doc whose source is null", () => {
    const { skipped } = extractJobFeaturesBatch([{ ...full, source: null as unknown as string }], NOW);
    assert.equal(skipped, 1);
  });
});
