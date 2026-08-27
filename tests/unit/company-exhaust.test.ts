import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeeklyCadence,
  getCompanyExhaust,
  isVerdictWindowSufficient,
  resolveCoverageLadder,
  resolveFundingOrListingCell,
  type FundingFacts,
  type SecFacts,
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
        profile: { data: { tagline: null } as never, source: "x", asOf: "x" },
        funding: null,
        secListing: null,
        govContracts: null,
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
