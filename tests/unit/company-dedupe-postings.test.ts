import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseDuplicatePostings } from "../../src/lib/companies/dedupe-postings";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * `collapseDuplicatePostings` (lib/companies/dedupe-postings.ts) — the same
 * role re-synced under a second id (live example: Stewart's "Escrow
 * Operations Intern", ingested twice, which is how a company page's hero KPI
 * disagreed with its own rendered role list — see open-count.ts's doc).
 * Keyed on title + `locationText`, the same text a role row itself renders,
 * so two rows a visitor can't tell apart never render as two.
 */
function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: null,
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

test("collapseDuplicatePostings: same title+location, a non-display field differs (id, salary) — collapses to the first", () => {
  const first = job({ id: "1", title: "Escrow Operations Intern", salary_min: 40_000 });
  const dupe = job({ id: "2", title: "Escrow Operations Intern", salary_min: 45_000 });
  assert.deepEqual(collapseDuplicatePostings([first, dupe]), [first]);
});

test("collapseDuplicatePostings: a URL-encoded/whitespace-only title difference is a distinct duplication pattern that also collapses", () => {
  const first = job({ id: "1", title: "Escrow%20Operations%20Intern" });
  const dupe = job({ id: "2", title: "  ESCROW OPERATIONS INTERN  " });
  assert.equal(collapseDuplicatePostings([first, dupe]).length, 1);
});

test("collapseDuplicatePostings: a genuinely different posting (different location) is kept alongside the first", () => {
  const a = job({ id: "1", title: "Escrow Operations Intern", location_city: "Edmond" });
  const b = job({ id: "2", title: "Escrow Operations Intern", location_city: "Houston" });
  assert.deepEqual(collapseDuplicatePostings([a, b]), [a, b]);
});

test("collapseDuplicatePostings: an empty list stays empty", () => {
  assert.deepEqual(collapseDuplicatePostings([]), []);
});

/**
 * Generic-fix rule: cover a case other than the one that surfaced the bug
 * (Stewart's "Escrow Operations Intern"). Three postings, three roles, one
 * of them re-synced under a second id — a shape any employer with a
 * duplicate-sync glitch can hit, not just Stewart's.
 */
test("collapseDuplicatePostings: a non-Stewart three-role set with one re-synced duplicate collapses to two", () => {
  const roles = [
    job({ id: "10", title: "Warehouse Associate", location_city: "Reno" }),
    job({ id: "11", title: "Warehouse Associate", location_city: "Reno" }), // re-synced dupe of "10"
    job({ id: "12", title: "Fleet Dispatcher", location_city: "Reno" }),
  ];
  const result = collapseDuplicatePostings(roles);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.id), ["10", "12"]);
});

/**
 * No-dupes passthrough: a roster with no repeated title+location pair must
 * come back unchanged, both in length and in order — `collapseDuplicatePostings`
 * should never reorder or drop a genuinely distinct posting.
 */
test("collapseDuplicatePostings: no duplicates — every posting passes through unchanged, same order", () => {
  const roles = [
    job({ id: "1", title: "Product Manager", location_city: "Austin" }),
    job({ id: "2", title: "Staff Engineer", location_city: "Remote" }),
    job({ id: "3", title: "Recruiter", location_city: "Denver" }),
  ];
  assert.deepEqual(collapseDuplicatePostings(roles), roles);
});
