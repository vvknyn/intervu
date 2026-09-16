import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildH1bSection,
  buildH1bSentence,
  buildWarnSection,
  buildWarnSentence,
  buildWeeklyCadence,
  getCompanyExhaust,
  isVerdictWindowSufficient,
  resolveCoverageLadder,
  resolveFundingOrListingCell,
  type FundingFacts,
  type H1bLcaFacts,
  type SecFacts,
  type WarnNoticeFacts,
} from "../../src/lib/companies/exhaust";
import type { Queryable } from "../../src/lib/pg/pool";

const NOW = Date.parse("2026-08-27T00:00:00Z");

describe("buildWeeklyCadence", () => {
  it("zero-fills every week when given no rows at all", () => {
    const series = buildWeeklyCadence([], NOW, 26);
    assert.equal(series.length, 26);
    assert.ok(series.every((w) => w.newListings === 0));
    // Series ends on the ISO week containing NOW and is chronological.
    assert.equal(series[25].weekStartIso, "2026-08-24");
    assert.equal(series[0].weekStartIso, "2026-03-02");
  });

  it("places a matched week's sum in the right bucket and zero-fills the rest", () => {
    const series = buildWeeklyCadence(
      [{ weekStartIso: "2026-08-17", newListings: 12 }],
      NOW,
      26,
    );
    const matched = series.find((w) => w.weekStartIso === "2026-08-17");
    assert.equal(matched?.newListings, 12);
    const others = series.filter((w) => w.weekStartIso !== "2026-08-17");
    assert.ok(others.every((w) => w.newListings === 0));
  });

  it("drops a week sum that falls outside the requested window", () => {
    const series = buildWeeklyCadence(
      [{ weekStartIso: "2020-01-06", newListings: 99 }],
      NOW,
      26,
    );
    assert.ok(series.every((w) => w.newListings === 0));
  });
});

describe("isVerdictWindowSufficient", () => {
  it("is false one day short of 90", () => {
    const since = new Date(NOW - 89 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isVerdictWindowSufficient(since, NOW), false);
  });

  it("is true at exactly 90 days (>= boundary)", () => {
    const since = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isVerdictWindowSufficient(since, NOW), true);
  });

  it("is true well past 90 days", () => {
    const since = new Date(NOW - 400 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isVerdictWindowSufficient(since, NOW), true);
  });

  it("is false on an unparseable timestamp", () => {
    assert.equal(isVerdictWindowSufficient("not-a-date", NOW), false);
  });
});

describe("resolveFundingOrListingCell", () => {
  const funding: FundingFacts = {
    latestFundingAmount: 85_000_000,
    latestFundingType: "series_c",
    latestFundingYear: 2021,
    formDCount: 2,
    formDDates: [],
  };
  const publicListing: SecFacts = {
    isPublicFiler: true,
    cik: "0001",
    latest10kDate: null,
    latest10qDate: null,
    latest8kDate: null,
    latestS1Date: null,
    hasS1: false,
    hasRestructuring8k: false,
    hasOfficerChange8k: false,
    totalFilings2y: null,
  };
  const privateFiler: SecFacts = { ...publicListing, isPublicFiler: false };

  it("prefers the SEC listing over funding for a public filer", () => {
    assert.equal(resolveFundingOrListingCell({ secListing: publicListing, funding }), "sec");
  });

  it("falls back to funding when the filer is private", () => {
    assert.equal(resolveFundingOrListingCell({ secListing: privateFiler, funding }), "funding");
  });

  it("falls back to funding when there is no SEC section at all", () => {
    assert.equal(resolveFundingOrListingCell({ secListing: null, funding }), "funding");
  });

  it("is null when neither section has data", () => {
    assert.equal(resolveFundingOrListingCell({ secListing: null, funding: null }), null);
  });
});

describe("resolveCoverageLadder", () => {
  it("is minimal when exhaust itself is unavailable", () => {
    assert.equal(resolveCoverageLadder(null), "minimal");
  });

  it("is thin when exhaust resolved but no enrichment profile exists", () => {
    assert.equal(
      resolveCoverageLadder({
        profile: null,
        funding: null,
        secListing: null,
        govContracts: null,
        h1bLca: null,
        warnNotices: null,
        health: null,
        cadence: null,
        integrity: null,
        techStack: null,
        changeHistory: null,
      }),
      "thin",
    );
  });

  it("is full when an enrichment profile row exists", () => {
    assert.equal(
      resolveCoverageLadder({
        profile: { data: { tagline: null } as never, source: "x", label: "x", asOf: "x" },
        funding: null,
        secListing: null,
        govContracts: null,
        h1bLca: null,
        warnNotices: null,
        health: null,
        cadence: null,
        integrity: null,
        techStack: null,
        changeHistory: null,
      }),
      "full",
    );
  });
});

/** Fake Queryable: fails one query by SQL substring, succeeds all others with empty rows. */
function fakeQueryableFailingOn(sqlSubstring: string): Queryable {
  return {
    query: async (text: string) => {
      if (text.includes(sqlSubstring)) throw new Error("simulated query failure");
      return { rows: [] };
    },
  };
}

describe("getCompanyExhaust — section isolation", () => {
  it("keeps other sections resolving when one query fails (not the happy path)", async () => {
    const pg = fakeQueryableFailingOn("company_change_events");
    const result = await getCompanyExhaust("example.com", () => pg);
    assert.ok(result, "exhaust module must still assemble a result");
    assert.equal(result?.changeHistory, null, "the broken section drops");
    // Sections backed by queries that succeeded (with empty rows) resolve to
    // null-for-no-data, not to an unhandled rejection — the whole call must
    // not throw or return undefined.
    assert.equal(result?.profile, null);
    assert.equal(result?.cadence, null);
  });

  it("returns null outright when the pg seam itself is unavailable", async () => {
    const result = await getCompanyExhaust("example.com", () => null);
    assert.equal(result, null);
  });
});

describe("buildH1bSection", () => {
  const fullPayload = {
    fiscal_year: 2026,
    initial_approvals: 40,
    continuing_approvals: 12,
    initial_denials: 3,
    continuing_denials: 0,
    employer_city: "Thousand Oaks",
    employer_state: "CA",
  };

  it("maps a full payload to a section", () => {
    const section = buildH1bSection({ data_type: "h1b_lca", payload: fullPayload, fetched_at: "2026-08-01T00:00:00Z" });
    assert.ok(section);
    assert.deepEqual(section?.data, {
      fiscalYear: 2026,
      initialApprovals: 40,
      continuingApprovals: 12,
      initialDenials: 3,
      continuingDenials: 0,
      employerCity: "Thousand Oaks",
      employerState: "CA",
    });
    assert.equal(section?.source, "company_enrichment · h1b_lca");
  });

  it("is null when the row is absent", () => {
    assert.equal(buildH1bSection(undefined), null);
  });

  it("is null when a required numeric key is missing (malformed payload)", () => {
    const { continuing_denials: _drop, ...partial } = fullPayload;
    const section = buildH1bSection({ data_type: "h1b_lca", payload: partial, fetched_at: "2026-08-01T00:00:00Z" });
    assert.equal(section, null);
  });
});

describe("buildH1bSentence", () => {
  const base: H1bLcaFacts = {
    fiscalYear: 2026,
    initialApprovals: 40,
    continuingApprovals: 12,
    initialDenials: 0,
    continuingDenials: 0,
    employerCity: null,
    employerState: null,
  };

  it("omits the denial clause when denials are zero", () => {
    assert.equal(
      buildH1bSentence(base),
      "52 h-1b approvals in fy2026 (40 initial, 12 continuing).",
    );
  });

  it("appends the denial clause when denials are present", () => {
    const withDenials: H1bLcaFacts = { ...base, initialDenials: 3, continuingDenials: 1 };
    assert.equal(
      buildH1bSentence(withDenials),
      "52 h-1b approvals in fy2026 (40 initial, 12 continuing). 4 denials in the same period.",
    );
  });
});

describe("buildWarnSection", () => {
  const recent = Array.from({ length: 5 }, (_, i) => ({
    employer_name: "Acme Corp",
    notice_date: `2026-0${(i % 9) + 1}-01`,
    layoff_date: `2026-0${(i % 9) + 1}-15`,
    employees_affected: 10 + i,
    location: "CA",
  }));

  it("maps a full payload to a section and caps recent rows at 3", () => {
    const section = buildWarnSection({
      data_type: "warn_notice",
      payload: { notice_count: 5, states: ["ca", "ny"], total_employees_affected: 120, recent },
      fetched_at: "2026-08-01T00:00:00Z",
    });
    assert.ok(section);
    assert.equal(section?.data.noticeCount, 5);
    assert.equal(section?.data.totalEmployeesAffected, 120);
    assert.deepEqual(section?.data.states, ["ca", "ny"]);
    assert.equal(section?.data.recent.length, 3);
    assert.equal(section?.source, "company_enrichment · warn_notice");
  });

  it("is null when the row is absent", () => {
    assert.equal(buildWarnSection(undefined), null);
  });

  it("is null when a required numeric key is missing (malformed payload)", () => {
    const section = buildWarnSection({
      data_type: "warn_notice",
      payload: { states: ["ca"], recent: [] },
      fetched_at: "2026-08-01T00:00:00Z",
    });
    assert.equal(section, null);
  });
});

describe("buildWarnSentence", () => {
  it("pluralizes notices and employees correctly", () => {
    const data: WarnNoticeFacts = { noticeCount: 5, totalEmployeesAffected: 120, states: [], recent: [] };
    assert.equal(buildWarnSentence(data), "5 layoff notices filed — 120 employees affected.");
  });

  it("uses singular grammar at count 1", () => {
    const data: WarnNoticeFacts = { noticeCount: 1, totalEmployeesAffected: 1, states: [], recent: [] };
    assert.equal(buildWarnSentence(data), "1 layoff notice filed — 1 employee affected.");
  });
});
