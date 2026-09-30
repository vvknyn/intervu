import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanyHiringAnswer, buildCompanyJobsUrl, hasCompanyKpiContent } from "@/lib/companies/presentation";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
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
    changeEvents: [],
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
    exhaust: null,
    nowMs: NOW,
    ...overrides,
  };
}

describe("companies/presentation — the answer to 'Is X hiring?'", () => {
  it("answers from the open-role count when the 90-day aggregates are absent (every employer today)", () => {
    const answer = buildCompanyHiringAnswer(company(), NOW);
    assert.equal(answer.hasOpenRoles, true);
    assert.equal(answer.headline, "213 open roles live on Velai right now");
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
    assert.equal(answer.headline, "213 open roles live on Velai right now");
    assert.equal(answer.trackRecord, "Last 90 days: 48 roles opened, 31 closed.");
  });

  it("keeps a floor a floor and singularises one role", () => {
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 200, openCountIsLowerBound: true }), NOW)
        .headline,
      "200+ open roles live on Velai right now",
    );
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 1 }), NOW).headline,
      "1 open role live on Velai right now",
    );
  });

  it("reports what Velai tracks rather than answering 'no' about the world", () => {
    const answer = buildCompanyHiringAnswer(company({ openCount: 0 }), NOW);
    assert.equal(answer.hasOpenRoles, false);
    assert.equal(answer.headline, "Velai isn't tracking any live open roles right now");
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
    });
    assert.equal(items[0]!.question, "Is Lumentum hiring?");
    assert.equal(items[0]!.answer, answer.headline);
  });
});

/** An exhaust carrying only the box database's opened/closed record. */
function withIntegrity(openedCount: number, closed: number, trackedSinceIso: string | null): CompanyExhaust {
  return {
    integrity: {
      data: {
        closedReasonCounts: closed > 0 ? [{ reason: "filled", label: "Filled", count: closed }] : [],
        openedCount,
        trackedSinceIso,
      },
      source: "job_listings",
      label: "Job listings",
      asOf: new Date(NOW).toISOString(),
    },
  } as unknown as CompanyExhaust;
}

describe("companies/presentation — the rail's hiring record reads the box database first", () => {
  it("prints the box record instead of 'isn't tracked' when the gated band below has one", () => {
    const answer = buildCompanyHiringAnswer(
      company({ exhaust: withIntegrity(14, 9, "2025-11-03T10:00:00Z") }),
      NOW,
    );
    assert.equal(answer.trackRecord, "Last 90 days: 14 roles opened, 9 closed.");
  });

  it("names when tracking began instead of calling a partial window 'last 90 days'", () => {
    // Tracking began Wednesday Jul 22, 2026 — 24 days before NOW.
    const answer = buildCompanyHiringAnswer(
      company({ exhaust: withIntegrity(3, 1, "2026-07-22T08:00:00Z") }),
      NOW,
    );
    assert.equal(
      answer.trackRecord,
      "Tracked since the week of Jul 20, 2026: 3 roles opened after that first week, 1 closed.",
    );
  });

  it("falls back to the index aggregates, then to naming the gap, when the box has no record", () => {
    assert.equal(
      buildCompanyHiringAnswer(company({ opened90d: 5, closed90d: 2, hasTrackRecord: true }), NOW).trackRecord,
      "Last 90 days: 5 roles opened, 2 closed.",
    );
    assert.match(buildCompanyHiringAnswer(company(), NOW).trackRecord, /aren't tracked/);
  });
});

describe("companies/presentation — live check beside the headline count", () => {
  const seen = (id: string, daysAgo: number, overrides: Partial<PublicJob> = {}) =>
    job({ id, last_observed_alive_at: new Date(NOW - daysAgo * DAY_MS).toISOString(), ...overrides });

  it("counts roles seen alive in the past 7 days, leaving out flagged and older ones", () => {
    const jobs = [
      seen("1", 1),
      seen("2", 6),
      seen("3", 2, { ghost_badge: "likely_ghost" }),
      seen("4", 12),
      job({ id: "5", ghost_checked_at: new Date(NOW - 3 * DAY_MS).toISOString() }),
      job({ id: "6" }),
    ];
    const answer = buildCompanyHiringAnswer(company({ jobs, openCount: jobs.length }), NOW);
    assert.equal(answer.headline, "6 open roles live on Velai right now");
    assert.equal(answer.liveCheck, "3 seen live in the past week");
  });

  it("says 'all' when every open role was seen live", () => {
    const jobs = [seen("1", 1), seen("2", 2)];
    assert.equal(
      buildCompanyHiringAnswer(company({ jobs, openCount: 2 }), NOW).liveCheck,
      "all seen live in the past week",
    );
  });

  it("is silent over a sample, and when nothing was seen live recently", () => {
    const jobs = [seen("1", 1), seen("2", 2)];
    assert.equal(
      buildCompanyHiringAnswer(company({ jobs, openCount: 200, openCountIsLowerBound: true }), NOW).liveCheck,
      "",
    );
    assert.equal(buildCompanyHiringAnswer(company({ jobs: [seen("1", 20)], openCount: 1 }), NOW).liveCheck, "");
  });
});

describe("companies/presentation — freshness fact (reconciles the CTA's own 30d default)", () => {
  // The window is /jobs' DEFAULT_URL_STATE.postedBucket — 90 days since
  // 2026-09-30 (30 before), so "old" fixtures sit at 120 days.
  it("states a true zero when every open role is older than /jobs' 90-day default (the Leogy case)", () => {
    // All 5 roles posted 120 days ago — still open, just outside the window.
    const jobs = Array.from({ length: 5 }, (_, i) =>
      job({ id: String(i), posted_ts: NOW - 120 * DAY_MS }),
    );
    const answer = buildCompanyHiringAnswer(company({ openCount: 5, jobs }), NOW);
    assert.equal(answer.freshness, "None of the 5 open roles were posted in the last 90 days.");
    // Never worded as an apology/warning — a plain, natural-language fact.
    assert.doesNotMatch(answer.freshness, /sorry|unfortunately|warning/i);
  });

  it("states every role as recent when every role is inside the window — not falsely 0", () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      job({ id: String(i), posted_ts: NOW - 2 * DAY_MS }),
    );
    const answer = buildCompanyHiringAnswer(company({ openCount: 4, jobs }), NOW);
    assert.equal(answer.freshness, "4 of 4 open roles were posted in the last 90 days.");
  });

  it("reports a genuine split accurately — not rounded to all-or-nothing", () => {
    const jobs = [
      job({ id: "1", posted_ts: NOW - 2 * DAY_MS }),
      job({ id: "2", posted_ts: NOW - 5 * DAY_MS }),
      job({ id: "3", posted_ts: NOW - 120 * DAY_MS }),
    ];
    const answer = buildCompanyHiringAnswer(company({ openCount: 3, jobs }), NOW);
    assert.equal(answer.freshness, "2 of 3 open roles were posted in the last 90 days.");
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
      job({ id: "2", posted_ts: NOW - 120 * DAY_MS }), // known, old
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
  it("round-trips through parseJobsUrl carrying posted=any — never inherits /jobs' default posted window", () => {
    const url = buildCompanyJobsUrl(company({ domain: "leogy.com" }));
    assert.match(url, /^\/jobs\?/);

    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.equal(parsed.companyDomain, "leogy.com");
    // undefined = "any" internally (see url-state.ts) — the whole point: the
    // page's own age-agnostic count must not silently regain /jobs' 90d cut.
    assert.equal(parsed.postedBucket, undefined);
  });

  // Two facts, one assertion. The value must be the neutral "any" sentinel —
  // stripped at meilisearch.ts:452, so it constrains nothing, and its only job
  // is satisfying `hasLocationSignal` so /jobs' IP geo default doesn't narrow a
  // company link. And it must never be a REAL country: a derived country facet
  // fails CLOSED against unverified corpus values (measured live 2026-08-15 —
  // Leogy's 5 real rows went to 0 under `country=Germany`/`country=DE`).
  it("carries country=any and never a real country value — the sentinel widens, a derived value would fail closed", () => {
    const url = buildCompanyJobsUrl(company({ domain: "multinational.com" }));
    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.deepEqual(parsed.facets.location_country, ["any"]);
    assert.ok(
      !(parsed.facets.location_country ?? []).some((v) => v !== "any"),
      "a company link must not derive a country value from page data",
    );
  });

  // Regression, measured live 2026-08-16 on /co/harrods--com: the page counted
  // 108 roles by domain while its CTA's `q=Harrods` returned 109 rows with ZERO
  // Harrods listings in the top 20 — "Harrods" is a VENUE, so Chanel/Burberry/
  // Saint Laurent/Hermès concession roles inside the store all matched the text.
  // The name is deliberately the ONE thing this URL must not contain.
  it("scopes by domain and puts NO company name in `q` — a name over-matches (venue) and under-matches (legal suffix)", () => {
    const url = buildCompanyJobsUrl(company({ domain: "harrods.com", name: "Harrods" }));
    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));

    assert.equal(parsed.companyDomain, "harrods.com");
    // The scope is the whole message; there is no text query riding alongside
    // it to AND against and quietly hide roles that don't repeat the name.
    assert.equal(parsed.q, "");
    assert.doesNotMatch(url, /[?&]q=/);
  });

  // The other half of the same failure: the index stores "Harrods Limited"
  // while the page displays the suffix-stripped "Harrods", so `isCompanyNameQuery`
  // (company-intent.ts, exact-match after normalization) could never rescue the
  // text query either. The domain is unaffected by display-name cleaning.
  it("is untouched by legal-suffix stripping — display name and scope are independent", () => {
    const stripped = buildCompanyJobsUrl(company({ domain: "harrods.com", name: "Harrods" }));
    const full = buildCompanyJobsUrl(company({ domain: "harrods.com", name: "Harrods Limited" }));
    assert.equal(stripped, full);
  });

  // Measured live 2026-08-16: "View all 108 jobs" landed on 78 — exactly the
  // 30 roles the page's own "28% ghost-flagged" tile had counted, silently
  // removed by /jobs' hide-ghosts default. A link that states a number must
  // not hand its destination a filter that removes part of it. Vivek's call,
  // 2026-08-17: show all of them, marked (see `rowTrustChip`'s `ghost` state).
  it("carries ghosts=show — the label's count includes ghost-flagged roles, so the destination must too", () => {
    const url = buildCompanyJobsUrl(company({ domain: "harrods.com" }));
    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.equal(parsed.hideGhosts, false);
  });

  // Both of /jobs' silent defaults, asserted together: the two have now each
  // caused the same class of bug (Leogy's 30d, Harrods' hide-ghosts), and a
  // third default arriving later should fail this test, not ship quietly.
  it("neutralizes every /jobs default that would subtract from the stated count", () => {
    const url = buildCompanyJobsUrl(company({ domain: "harrods.com" }));
    const parsed = parseJobsUrl(new URLSearchParams(url.slice(url.indexOf("?"))));
    assert.equal(parsed.postedBucket, undefined, "no 30-day window");
    assert.equal(parsed.hideGhosts, false, "no ghost exclusion");
    assert.equal(parsed.salaryMin, 0, "no salary floor");
    assert.equal(parsed.visaOnly, false, "no visa requirement");
    // Not `deepEqual(facets, {})`: a facet is allowed here IF it cannot
    // subtract, and `"any"`/`"all"` are stripped before the clause is rendered
    // (meilisearch.ts:452). Anything else is a real value and would narrow —
    // which is the thing this test exists to catch.
    for (const [field, values] of Object.entries(parsed.facets)) {
      assert.deepEqual(
        (values ?? []).filter((v) => v !== "any" && v !== "all"),
        [],
        `facet ${field} carries a narrowing value`,
      );
    }
  });
});

describe("companies/presentation — hasCompanyKpiContent", () => {
  it("hides the KPI row when there are zero open roles and no 90-day track record", () => {
    assert.equal(
      hasCompanyKpiContent(company({ openCount: 0, hasTrackRecord: false })),
      false,
    );
  });

  it("shows the row when there are open roles, even with no track record", () => {
    assert.equal(
      hasCompanyKpiContent(company({ openCount: 5, hasTrackRecord: false })),
      true,
    );
  });

  // A different employer shape than the one that motivated the fix: zero
  // roles TODAY but a real 90-day history is still something to show, not a
  // dead row — the gate is an OR, not "roles only".
  it("shows the row when there are zero open roles but a real 90-day track record exists", () => {
    assert.equal(
      hasCompanyKpiContent(company({ openCount: 0, hasTrackRecord: true })),
      true,
    );
  });
});
