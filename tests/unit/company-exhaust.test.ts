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
  resolveSector,
  type FundingFacts,
  type H1bLcaFacts,
  type SecFacts,
  type WarnNoticeFacts,
} from "../../src/lib/companies/exhaust";
import { hiringRecordSentence, isoWeekStart } from "../../src/lib/companies/hiring-record";
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

  it("marks only the week containing now as in progress", () => {
    const series = buildWeeklyCadence([], NOW, 26);
    assert.equal(series[25].inProgress, true);
    assert.ok(series.slice(0, 25).every((w) => !w.inProgress));
  });

  it("starts at the first tracked week when tracking began inside the window, and flags it", () => {
    // Tracking began Wednesday Aug 5; the weeks before were never watched,
    // so they are not drawn as zeros.
    const series = buildWeeklyCadence(
      [
        { weekStartIso: "2026-08-03", newListings: 40 },
        { weekStartIso: "2026-08-17", newListings: 3 },
      ],
      NOW,
      26,
      "2026-08-05",
    );
    assert.deepEqual(
      series.map((w) => [w.weekStartIso, w.newListings, w.firstTracked, w.inProgress]),
      [
        ["2026-08-03", 40, true, false],
        ["2026-08-10", 0, false, false],
        ["2026-08-17", 3, false, false],
        ["2026-08-24", 0, false, true],
      ],
    );
  });

  it("keeps the full window and flags nothing when tracking began before it", () => {
    const series = buildWeeklyCadence([], NOW, 26, "2025-06-01");
    assert.equal(series.length, 26);
    assert.ok(series.every((w) => !w.firstTracked));
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the UTC week, including on a Sunday", () => {
    assert.equal(isoWeekStart(Date.parse("2026-08-27T23:00:00Z")), "2026-08-24");
    assert.equal(isoWeekStart(Date.parse("2026-08-30T12:00:00Z")), "2026-08-24");
    assert.equal(isoWeekStart(Date.parse("2026-08-31T00:00:00Z")), "2026-08-31");
  });
});

describe("hiringRecordSentence", () => {
  const facts = (openedCount: number, closed: number, trackedSinceIso: string | null) => ({
    closedReasonCounts: closed > 0 ? [{ reason: "filled", label: "Filled", count: closed }] : [],
    openedCount,
    trackedSinceIso,
  });

  it("states the 90-day window when tracking began before it", () => {
    assert.equal(hiringRecordSentence(facts(12, 1, "2025-01-10"), NOW), "Last 90 days: 12 roles opened, 1 closed.");
  });

  it("names the tracking start when it falls inside the window, and says the first week is left out", () => {
    assert.equal(
      hiringRecordSentence(facts(1, 0, "2026-08-05T09:00:00Z"), NOW),
      "Tracked since the week of Aug 3, 2026: 1 role opened after that first week, 0 closed.",
    );
  });

  it("reads an unknown tracking start as the full window", () => {
    assert.equal(hiringRecordSentence(facts(2, 3, null), NOW), "Last 90 days: 2 roles opened, 3 closed.");
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
        sector: null,
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
        sector: null,
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

  it("carries when tracking began into the cadence and integrity sections", async () => {
    const pg: Queryable = {
      query: async <R,>(text: string) => {
        let rows: unknown[] = [];
        if (text.includes("MIN(day)")) rows = [{ first_day: "2026-08-05" }];
        else if (text.includes("company_posting_daily")) rows = [{ week_start: "2026-08-03", total: 40 }];
        else if (text.includes("MIN(first_seen_at)")) rows = [{ n: 2, tracked_since: "2026-08-05", tracked: true }];
        return { rows: rows as R[] };
      },
    };
    const result = await getCompanyExhaust("example.com", () => pg, NOW);
    assert.equal(result?.cadence?.data.trackedSinceIso, "2026-08-05");
    assert.equal(result?.cadence?.data.weeks[0].weekStartIso, "2026-08-03");
    assert.equal(result?.cadence?.data.weeks[0].firstTracked, true);
    assert.equal(result?.integrity?.data.openedCount, 2);
    assert.equal(result?.integrity?.data.trackedSinceIso, "2026-08-05");
  });

  it("keeps a zero record for an employer tracked since before the window", async () => {
    const pg: Queryable = {
      query: async <R,>(text: string) => {
        const rows = text.includes("MIN(first_seen_at)") ? [{ n: 0, tracked_since: null, tracked: true }] : [];
        return { rows: rows as R[] };
      },
    };
    const result = await getCompanyExhaust("example.com", () => pg, NOW);
    assert.equal(result?.integrity?.data.openedCount, 0);
    assert.equal(result?.integrity?.data.trackedSinceIso, null);
  });

  it("reads job_listings only inside a bounded window, never every row the employer ever had", async () => {
    const reads: string[] = [];
    const pg: Queryable = {
      query: async <R,>(text: string) => {
        if (text.includes("job_listings")) reads.push(text);
        return { rows: [] as R[] };
      },
    };
    await getCompanyExhaust("example.com", () => pg, NOW);
    assert.ok(reads.length > 0);
    for (const sql of reads) {
      // A whole-row reference (`j.*`) detoasts every row's description.
      assert.doesNotMatch(sql, /\b\w+\.\*/);
      // Every scan of the table is bounded by a date on the indexed domain.
      const scans = sql.split(/FROM job_listings/).slice(1);
      for (const scan of scans) assert.match(scan, /company_domain = \$1 AND (first_seen_at|closed_at) [<>]=? now\(\)/);
    }
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

describe("resolveSector — health_reviews, then fingerprints, then boards", () => {
  it("takes the first source that names a real sector", () => {
    assert.equal(resolveSector({ health_reviews: "Fintech", fingerprints: "Retail", boards: "Energy" }), "Fintech");
    assert.equal(resolveSector({ health_reviews: null, fingerprints: "Retail", boards: "Energy" }), "Retail");
  });

  it("skips the default bucket so a real boards.sector still wins", () => {
    assert.equal(resolveSector({ health_reviews: "general", fingerprints: " Unknown ", boards: "Healthcare" }), "Healthcare");
    assert.equal(resolveSector({ health_reviews: null, fingerprints: "", boards: "Healthcare" }), "Healthcare");
  });

  it("is null when no source names one", () => {
    assert.equal(resolveSector({ health_reviews: "general", fingerprints: null, boards: null }), null);
    assert.equal(resolveSector(null), null);
  });
});
