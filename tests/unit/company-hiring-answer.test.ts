import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanyHiringAnswer, buildCompanyJobsUrl } from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import { parseJobsUrl } from "@/lib/jobs/url-state";
import type { PublicJob } from "@/lib/jobs/types";
import { buildCompanyFaqItems } from "@/lib/seo/jsonld";

// Fixed clock so freshness assertions are deterministic without a fake timer
// (same convention `buildCompanyHiringAnswer`'s own docblock cites for
// `searchResultLine`, lib/jobs/presentation.ts).
const NOW = Date.parse("2026-08-15T00:00:00Z");
const DAY_MS = 86_400_000;

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Lumentum",
    company_domain: "lumentum.com",
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

function company(overrides: Partial<CompanyPageData> = {}): CompanyPageData {
  return {
    domain: "lumentum.com",
    slug: "lumentum--com",
    name: "Lumentum",
    nameSource: "corpus-cased",
    oneLiner: null,
    stage: null,
    opened90d: null,
    closed90d: null,
    hasTrackRecord: false,
    openCount: 213,
    openCountIsLowerBound: false,
    ghostFlaggedPct: null,
    jobs: [],
    boards: ["elite"],
    nowMs: NOW,
    ...overrides,
  };
}

describe("companies/presentation — the answer to 'Is X hiring?'", () => {
  it("answers from the open-role count when the 90-day aggregates are absent (every employer today)", () => {
    const answer = buildCompanyHiringAnswer(company(), NOW);
    assert.equal(answer.hasOpenRoles, true);
    assert.equal(answer.headline, "Yes — 213 open roles are live on intervu right now.");
    // The half it does NOT have is stated as missing, not implied, not
    // rendered as a plausible-looking zero or an em-dash on its own.
    assert.equal(
      answer.trackRecord,
      "Opened and closed counts for the last 90 days aren't tracked for this employer yet.",
    );
    // No count of any kind is asserted about the window it cannot see.
    assert.doesNotMatch(answer.trackRecord, /\d+ roles? (opened|closed)/);
  });

  it("gets richer from the same code once the aggregates arrive — no edit required", () => {
    const answer = buildCompanyHiringAnswer(
      company({ opened90d: 48, closed90d: 31, hasTrackRecord: true }),
      NOW,
    );
    assert.equal(answer.headline, "Yes — 213 open roles are live on intervu right now.");
    assert.equal(answer.trackRecord, "Last 90 days: 48 roles opened, 31 closed.");
  });

  it("keeps a floor a floor and singularises one role", () => {
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 200, openCountIsLowerBound: true }), NOW)
        .headline,
      "Yes — 200+ open roles are live on intervu right now.",
    );
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 1 }), NOW).headline,
      "Yes — 1 open role is live on intervu right now.",
    );
  });

  it("reports what intervu tracks rather than answering 'no' about the world", () => {
    const answer = buildCompanyHiringAnswer(company({ openCount: 0 }), NOW);
    assert.equal(answer.hasOpenRoles, false);
    assert.equal(answer.headline, "intervu isn't tracking any live open roles right now.");
    assert.doesNotMatch(answer.headline, /^(Yes|No)\b/);
    // A zero-role employer still gets the 90-day record when one exists.
    assert.equal(
      buildCompanyHiringAnswer(
        company({ openCount: 0, opened90d: 0, closed90d: 12, hasTrackRecord: true }),
        NOW,
      ).trackRecord,
      "Last 90 days: 0 roles opened, 12 closed.",
    );
  });

  it("hands the FAQPage structured data the exact sentence the body renders", () => {
    const answer = buildCompanyHiringAnswer(company(), NOW);
    const items = buildCompanyFaqItems({
      companyName: "Lumentum",
      hiringAnswer: answer.headline,
      ghostFlaggedPct: null,
    });
    assert.equal(items[0]!.question, "Is Lumentum hiring?");
    assert.equal(items[0]!.answer, answer.headline);
  });
});

describe("companies/presentation — freshness fact (reconciles the CTA's own 30d default)", () => {
  it("states a true zero when every open role is older than /jobs' 30-day default (the Leogy case)", () => {
    // All 5 roles posted 45 days ago — still open, just outside the window.
    const jobs = Array.from({ length: 5 }, (_, i) =>
      job({ id: String(i), posted_ts: NOW - 45 * DAY_MS }),
    );
    const answer = buildCompanyHiringAnswer(company({ openCount: 5, jobs }), NOW);
    assert.equal(answer.freshness, "None of the 5 open roles were posted in the last 30 days.");
    // Never worded as an apology/warning — a plain, natural-language fact.
    assert.doesNotMatch(answer.freshness, /sorry|unfortunately|warning/i);
  });

  it("states every role as recent when every role is inside the window — not falsely 0", () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      job({ id: String(i), posted_ts: NOW - 2 * DAY_MS }),
    );
    const answer = buildCompanyHiringAnswer(company({ openCount: 4, jobs }), NOW);
    assert.equal(answer.freshness, "4 of 4 open roles were posted in the last 30 days.");
  });

  it("reports a genuine split accurately — not rounded to all-or-nothing", () => {
    const jobs = [
      job({ id: "1", posted_ts: NOW - 2 * DAY_MS }),
      job({ id: "2", posted_ts: NOW - 5 * DAY_MS }),
      job({ id: "3", posted_ts: NOW - 45 * DAY_MS }),
    ];
    const answer = buildCompanyHiringAnswer(company({ openCount: 3, jobs }), NOW);
    assert.equal(answer.freshness, "2 of 3 open roles were posted in the last 30 days.");
  });

  it("says nothing when there are no fetched roles to measure, rather than a fabricated '0 of 0'", () => {
    const answer = buildCompanyHiringAnswer(company({ openCount: 0, jobs: [] }), NOW);
    assert.equal(answer.freshness, "");
  });

  it("omits the fact for an employer above the fetch cap — never presents the 200-role WINDOW as the role count (stripe.com/amazon.com shape)", () => {
    const jobs = Array.from({ length: 200 }, (_, i) =>
      job({ id: String(i), posted_ts: NOW - 2 * DAY_MS }),
    );
    const answer = buildCompanyHiringAnswer(
      company({ openCount: 582, openCountIsLowerBound: true, jobs }),
      NOW,
    );
    assert.equal(answer.freshness, "");
    assert.doesNotMatch(answer.freshness, /200/);
  });

  it("omits the fact rather than shrink the denominator — a partial known-date set must never disagree with the 'N open roles' headline above it", () => {
    const jobs = [
      job({ id: "1", posted_ts: NOW - 2 * DAY_MS }), // known, recent
      job({ id: "2", posted_ts: NOW - 45 * DAY_MS }), // known, old
      job({ id: "3", posted_ts: null }), // unknown
      job({ id: "4", posted_ts: null }), // unknown
      job({ id: "5", posted_ts: NOW - 3 * DAY_MS }), // known, recent
    ];
    // A "2 of 3" sentence here would silently disagree with the "5 open
    // roles" headline the page states one line above — omit instead.
    const answer = buildCompanyHiringAnswer(company({ openCount: 5, jobs }), NOW);
    assert.equal(answer.freshness, "");
  });

  it("says nothing when every fetched role has an unknown posted date — never infers '0 recent' from silence", () => {
    const jobs = [
      job({ id: "1", posted_ts: null }),
      job({ id: "2", posted_ts: null }),
      job({ id: "3", posted_ts: null }),
    ];
    const answer = buildCompanyHiringAnswer(company({ openCount: 3, jobs }), NOW);
    assert.equal(answer.freshness, "");
  });
});

describe("companies/presentation — buildCompanyJobsUrl (the CTA must transmit scope)", () => {
  it("round-trips through parseJobsUrl carrying posted=any — never inherits /jobs' 30d default", () => {
    const url = buildCompanyJobsUrl(company({ name: "Leogy" }));
    assert.match(url, /^\/jobs\?/);

    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.equal(parsed.q, "Leogy");
    // undefined = "any" internally (see url-state.ts) — the whole point: the
    // page's own age-agnostic count must not silently regain /jobs' 30d cut.
    assert.equal(parsed.postedBucket, undefined);
  });

  it("carries country=any to suppress regional IP defaults for worldwide company search", () => {
    const url = buildCompanyJobsUrl(company({ name: "Multinational Co" }));
    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.deepEqual(parsed.facets.location_country, ["any"]);
  });
});
