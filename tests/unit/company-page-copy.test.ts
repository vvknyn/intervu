import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPromptBody, fitPromptTitle, staleShareText } from "../../src/components/company/company-page-copy";
import type { PublicJob } from "../../src/lib/jobs/types";

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

function jobs(n: number): PublicJob[] {
  return Array.from({ length: n }, (_, i) => job({ id: String(i) }));
}

test("staleShareText: restates the pct as the count it was computed from (the audit's own '9 of the 68 shown' example)", () => {
  // 13% of 68 = 8.84, rounds to 9 — exactly the live number that motivated
  // this rewrite (13% possibly-stale of 68 shown).
  assert.equal(staleShareText({ ghostFlaggedPct: 13, jobs: jobs(68) }), "9 of the 68 roles tracked here may no longer be live.");
});

test("staleShareText: a SECOND company shape — a smaller window with a different pct rounds independently, not off the first case's numbers", () => {
  // 25% of 12 = 3 exactly, no rounding ambiguity — proves this isn't
  // hardcoded around the 68/9 example above.
  assert.equal(staleShareText({ ghostFlaggedPct: 25, jobs: jobs(12) }), "3 of the 12 roles tracked here may no longer be live.");
});

test("staleShareText: null pct (no fetched window) renders no sentence, not a fabricated 0", () => {
  assert.equal(staleShareText({ ghostFlaggedPct: null, jobs: [] }), null);
});

test("staleShareText: zero flagged still states the honest zero count, not null", () => {
  assert.equal(staleShareText({ ghostFlaggedPct: 0, jobs: jobs(5) }), "0 of the 5 roles tracked here may no longer be live.");
});

test("fitPromptTitle counts the roles the résumé would be scored against", () => {
  assert.equal(fitPromptTitle(12, false), "Which of these 12 roles fit you?");
  assert.equal(fitPromptTitle(1, false), "Does this open role fit you?");
  // Only the newest roles are loaded: the question says so, as the fit stat does.
  assert.equal(fitPromptTitle(200, true), "Which of the 200 newest roles here fit you?");
});

test("fitPromptBody says where the résumé is kept", () => {
  assert.match(fitPromptBody(false), /It stays in this browser\.$/);
  assert.match(fitPromptBody(true), /It's saved to your account\.$/);
});
