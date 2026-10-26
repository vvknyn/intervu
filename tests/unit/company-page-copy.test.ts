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

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const checked = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

/** n rows with a check from yesterday (fresh under `checkFreshness`). */
function jobs(n: number, daysAgo = 1): PublicJob[] {
  return Array.from({ length: n }, (_, i) => job({ id: String(i), ghost_checked_at: checked(daysAgo) }));
}

test("staleShareText: restates the pct as the count it was computed from (the audit's own '9 of the 68 shown' example)", () => {
  // 13% of 68 = 8.84, rounds to 9 — exactly the live number that motivated
  // this rewrite (13% possibly-stale of 68 shown).
  assert.equal(staleShareText({ ghostFlaggedPct: 13, jobs: jobs(68), openCount: 68, openCountIsLowerBound: false, nowMs: NOW }), "9 of the 68 roles tracked here may no longer be live.");
});

test("staleShareText: a SECOND company shape — a smaller window with a different pct rounds independently, not off the first case's numbers", () => {
  // 25% of 12 = 3 exactly, no rounding ambiguity — proves this isn't
  // hardcoded around the 68/9 example above.
  assert.equal(staleShareText({ ghostFlaggedPct: 25, jobs: jobs(12), openCount: 12, openCountIsLowerBound: false, nowMs: NOW }), "3 of the 12 roles tracked here may no longer be live.");
});

test("staleShareText: a window that is only a sample of the open count names no second count (a floor, or more roles than loaded)", () => {
  assert.equal(staleShareText({ ghostFlaggedPct: 25, jobs: jobs(12), openCount: 40, openCountIsLowerBound: false, nowMs: NOW }), "3 of the newest roles tracked here may no longer be live.");
  assert.equal(staleShareText({ ghostFlaggedPct: 25, jobs: jobs(12), openCount: 12, openCountIsLowerBound: true, nowMs: NOW }), "3 of the newest roles tracked here may no longer be live.");
});

test("staleShareText: null pct (no fetched window) renders no sentence, not a fabricated 0", () => {
  assert.equal(staleShareText({ ghostFlaggedPct: null, jobs: [], openCount: 0, openCountIsLowerBound: false, nowMs: NOW }), null);
});

test("staleShareText: nothing flagged and nothing stale says so in words, never '0 of …'", () => {
  const text = staleShareText({ ghostFlaggedPct: 0, jobs: jobs(5), openCount: 5, openCountIsLowerBound: false, nowMs: NOW });
  assert.equal(text, "None of the 5 roles are flagged as possibly stale.");
});

test("staleShareText: all rows past the freshness window and no flags counts them as not recently verified", () => {
  const text = staleShareText({ ghostFlaggedPct: 0, jobs: jobs(4, 120), openCount: 4, openCountIsLowerBound: false, nowMs: NOW });
  assert.equal(text, "4 of the 4 roles are not recently verified.");
});

test("staleShareText: mixed fresh and stale rows count only the stale ones; a sample names no second count", () => {
  const mixed = [...jobs(3, 1), ...jobs(2, 90).map((j, i) => ({ ...j, id: `s${i}` }))];
  assert.equal(staleShareText({ ghostFlaggedPct: 0, jobs: mixed, openCount: 5, openCountIsLowerBound: false, nowMs: NOW }), "2 of the 5 roles are not recently verified.");
  assert.equal(staleShareText({ ghostFlaggedPct: 0, jobs: mixed, openCount: 900, openCountIsLowerBound: false, nowMs: NOW }), "2 of the newest roles are not recently verified.");
});

test("staleShareText: flagged and stale together keep the flagged sentence, then add the unverified one", () => {
  const rows = [...jobs(3, 1), job({ id: "g", ghost_badge: "likely_ghost", ghost_checked_at: checked(1) }), job({ id: "x", ghost_checked_at: checked(60) })];
  assert.equal(
    staleShareText({ ghostFlaggedPct: 20, jobs: rows, openCount: 5, openCountIsLowerBound: false, nowMs: NOW }),
    "1 of the 5 roles tracked here may no longer be live. 1 of the 5 roles is not recently verified.",
  );
});

test("fitPromptTitle counts the roles the résumé would be scored against", () => {
  assert.equal(fitPromptTitle(12, false), "Which of these 12 roles fit you?");
  assert.equal(fitPromptTitle(1, false), "Does this open role fit you?");
  // Only the newest roles are loaded: the question says so, as the fit stat does.
  assert.equal(fitPromptTitle(200, true), "Which of the 200 newest roles here fit you?");
});

test("fitPromptBody says where the résumé is kept: saved only when the account has paid time", () => {
  assert.match(fitPromptBody(false), /It stays in this browser\.$/);
  assert.match(fitPromptBody(true), /It's saved to your account, encrypted\.$/);
});
