import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyRoleSearch, jobMatchesQuery, levelText, roleFitStat, sortByFit } from "@/components/company/CompanyRoleSearch";
import { MATCH_BAND_STRONG_MIN, type MatchScore } from "@/lib/match/score";
import { ExhaustGateSignInCard } from "@/components/company/CompanyExhaustGate";
import { buildCompanyRoleStats, type CompanyRoleStat } from "@/lib/companies/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * The company page's first screen: a stat row a job seeker decides on before
 * reading the list, role rows that answer "how old, what level", and the one
 * signed-out gate the rest of the site uses.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: "acme.example",
    location: "Columbus, OH, United States",
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "onsite",
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
    posted_ts: NOW - 5 * DAY,
    ...overrides,
  };
}

const yearly = (min: number, max: number) =>
  ({ salary_min: min, salary_max: max, salary_currency: "USD", salary_period: "year" }) as const;

function stats(jobs: PublicJob[], extra: { openCount?: number; openCountIsLowerBound?: boolean } = {}) {
  return buildCompanyRoleStats(
    { jobs, openCount: extra.openCount ?? jobs.length, openCountIsLowerBound: extra.openCountIsLowerBound ?? false },
    NOW,
  );
}

const byKey = (list: CompanyRoleStat[]) => Object.fromEntries(list.map((s) => [s.key, s]));

describe("buildCompanyRoleStats", () => {
  const roles = [
    job({ id: "1", ...yearly(100_000, 140_000), visa_sponsorship: true }),
    job({ id: "2", ...yearly(120_000, 160_000) }),
    job({ id: "3", ...yearly(150_000, 190_000), posted_ts: NOW - 45 * DAY }),
    job({ id: "4", posted_ts: NOW - 60 * DAY }),
  ];

  it("counts recent roles, roles with pay, the typical yearly range and stated visa sponsorship", () => {
    const s = byKey(stats(roles));
    assert.deepEqual(s.recent, { key: "recent", value: "2", label: "new in the last 30 days" });
    assert.deepEqual(s.pay, { key: "pay", value: "3 of 4", label: "list pay" });
    assert.equal(s["typical-pay"].label, "typical listed pay");
    assert.match(s["typical-pay"].value, /^USD \d+k–\d+k\/yr$/);
    assert.deepEqual(s.visa, { key: "visa", value: "1 of 4", label: "say they sponsor visas" });
  });

  it("says nothing when the fetched roles are only a sample of the company's open roles", () => {
    assert.deepEqual(stats(roles, { openCount: 400 }), []);
    assert.deepEqual(stats(roles, { openCountIsLowerBound: true }), []);
    assert.deepEqual(stats([]), []);
  });

  it("drops the recent count when any role's posted date is unknown, instead of shrinking the denominator", () => {
    const s = byKey(stats([...roles, job({ id: "5", posted_ts: null })]));
    assert.equal(s.recent, undefined);
    assert.equal(s.pay.value, "3 of 5");
  });

  it("leaves out a typical range built from fewer than three yearly salaries, and never converts hourly pay", () => {
    const s = byKey(
      stats([
        job({ id: "1", ...yearly(100_000, 140_000) }),
        job({ id: "2", ...yearly(120_000, 160_000) }),
        job({ id: "3", salary_min: 40, salary_max: 60, salary_currency: "USD", salary_period: "hour" }),
      ]),
    );
    assert.equal(s["typical-pay"], undefined);
    assert.equal(s.pay.value, "3 of 3");
  });

  it("omits the visa figure when no posting says it sponsors, since unsaid is not 'no'", () => {
    assert.equal(byKey(stats([job({ id: "1" }), job({ id: "2", visa_sponsorship: false })])).visa, undefined);
  });
});

describe("levelText", () => {
  it("names the corpus levels in words and says nothing for an unknown level", () => {
    assert.equal(levelText("entry"), "Entry level");
    assert.equal(levelText("mid"), "Mid-level");
    assert.equal(levelText("SENIOR"), "Senior");
    assert.equal(levelText(null), null);
    assert.equal(levelText(""), null);
  });
});

describe("jobMatchesQuery", () => {
  const role = job({ id: "1", title: "Machine Learning Engineer, Perception", experience_level: "mid" });

  it("matches every word of the query in any order, across title, location and level", () => {
    assert.equal(jobMatchesQuery(role, "perception engineer"), true);
    assert.equal(jobMatchesQuery(role, "  Engineer   COLUMBUS "), true);
    assert.equal(jobMatchesQuery(role, "mid-level"), true, "the level as the row says it");
    assert.equal(jobMatchesQuery(role, ""), true);
  });

  it("rejects a query with any word the role doesn't carry", () => {
    assert.equal(jobMatchesQuery(role, "perception senior"), false);
    assert.equal(jobMatchesQuery(role, "zzzz"), false);
  });
});

describe("roleFitStat and sortByFit: the résumé-loaded first screen", () => {
  const score = (total: number): MatchScore => ({ total, components: [] });
  const scores = new Map<string, MatchScore | null>([
    ["a", score(40)],
    ["b", score(MATCH_BAND_STRONG_MIN + 5)],
    ["c", null],
    ["d", score(MATCH_BAND_STRONG_MIN)],
  ]);

  it("counts strong fits over the loaded roles, and says 'newest' when those are a sample", () => {
    assert.deepEqual(roleFitStat(scores, 4, false), { key: "fit", value: "2 of 4", label: "strong fit for your résumé" });
    assert.deepEqual(roleFitStat(scores, 4, true), { key: "fit", value: "2", label: "strong fits among the 4 newest" });
    assert.equal(roleFitStat(null, 4, false), null);
  });

  it("sorts best fit first, keeps unscored roles last, and leaves the order alone without a résumé", () => {
    const jobs = ["a", "b", "c", "d"].map((id) => job({ id }));
    assert.deepEqual(sortByFit(jobs, scores).map((j) => j.id), ["b", "d", "a", "c"]);
    assert.deepEqual(sortByFit(jobs, null).map((j) => j.id), ["a", "b", "c", "d"]);
    assert.deepEqual(jobs.map((j) => j.id), ["a", "b", "c", "d"], "sorting must not reorder the caller's array");
  });
});

function renderRoles(jobs: PublicJob[], roleStats: CompanyRoleStat[] = []): string {
  return renderToStaticMarkup(
    React.createElement(CompanyRoleSearch, {
      jobs,
      companyDomain: "acme.example",
      companySlug: "acme--example",
      companyName: "Acme",
      openCountLabel: String(jobs.length),
      searchesPartialWindow: false,
      jobsSearchUrl: "/jobs?companyDomain=acme.example",
      now: NOW,
      stats: roleStats,
    }),
  );
}

describe("CompanyRoleSearch: first screen", () => {
  it("draws the stat row above the roles when there are stats, and none when there are not", () => {
    const html = renderRoles([job({ id: "1" })], [{ key: "pay", value: "7 of 12", label: "list pay" }]);
    assert.match(html, /data-testid="company-role-stats"[\s\S]*7 of 12[\s\S]*list pay/);
    assert.ok(html.indexOf("company-role-stats") < html.indexOf("Open roles"));
    assert.doesNotMatch(renderRoles([job({ id: "1" })]), /company-role-stats/);
  });

  it("puts the posting's age in the row's right rail instead of a bare 'View'", () => {
    const html = renderRoles([job({ id: "1", posted_at: new Date(NOW - 6 * DAY).toISOString() })]);
    assert.match(html, /data-testid="company-role-age"[^>]*>6d ago</);
    assert.doesNotMatch(html, />View</);
  });

  it("says the level right after the pay, ahead of the location a phone cuts", () => {
    const html = renderRoles([job({ id: "1", ...yearly(130_000, 170_000), experience_level: "senior" })]);
    const pay = html.indexOf("USD 130k");
    const level = html.indexOf(">Senior<");
    const location = html.indexOf("Columbus");
    assert.ok(pay !== -1 && level !== -1 && location !== -1, "pay, level and location should all render");
    assert.ok(pay < level && level < location, "the level sits between the pay and the location");
  });

  it("an empty list reads left-aligned with one next action, not a centred dashed box", () => {
    const html = renderRoles([]);
    assert.match(html, /data-testid="company-roles-empty" class="py-8"/);
    assert.doesNotMatch(html, /border-dashed|text-center/);
  });
});

describe("ExhaustGateSignInCard", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExhaustGateSignInCard, {
      slug: "acme--example",
      displayName: "Acme",
      teasers: [{ title: "Posting integrity", description: "How their postings close.", count: "14 closed" }],
    }),
  );

  it("is the site's SignupGate, returning the visitor to this company page", () => {
    assert.match(html, /data-testid="company-exhaust-gate"/);
    assert.match(html, /data-testid="signup-gate-create"/);
    assert.match(html, /Open the full hiring record/);
    assert.match(html, /co%2Facme--example|\/co\/acme--example/);
  });

  it("keeps the real per-band counts and names what following adds", () => {
    assert.match(html, /Posting integrity[\s\S]*14 closed/);
    assert.match(html, /Following Acme also shows its hiring history/);
    assert.doesNotMatch(html, /shadow-/);
  });
});
