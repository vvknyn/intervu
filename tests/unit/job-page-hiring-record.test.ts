import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { companyHiringRecord } from "@/lib/companies/exhaust-cache";
import type { CompanyExhaust } from "@/lib/companies/exhaust";

const NOW = Date.parse("2026-10-24T00:00:00Z");

// Synthetic employers; the job documents they would sit beside carry a sync aggregate (999/888) that must never surface.
const exhaustWith = (openedCount: number, closed: number, trackedSinceIso: string | null) =>
  ({
    integrity: {
      data: { closedReasonCounts: [{ reason: "filled", label: "Filled", count: closed }], openedCount, trackedSinceIso },
      source: "job_listings",
      label: "Job listings",
      asOf: new Date(NOW).toISOString(),
    },
  }) as unknown as CompanyExhaust;

describe("job pages state the employer record from the shared integrity read only", () => {
  it("tracked inside the window: names the start, excludes the first-week backlog", async () => {
    const line = (await companyHiringRecord("Zed.Example ", async (d) => (d === "zed.example" ? exhaustWith(7, 3, "2026-09-30T08:00:00Z") : null), NOW))?.sentence;
    assert.equal(line, "Tracked since the week of Sep 28, 2026: 7 roles opened after that first week, 3 closed.");
  });

  it("tracked before the window: states the full window", async () => {
    const line = (await companyHiringRecord("acme.example", async () => exhaustWith(21, 18, "2026-02-02T08:00:00Z"), NOW))?.sentence;
    assert.equal(line, "Last 13 weeks: 21 roles opened, 18 closed.");
    assert.doesNotMatch(line ?? "", /999|888/);
  });

  it("integrity facts missing (no box read, or a read without the section): no line at all", async () => {
    assert.equal(await companyHiringRecord("none.example", async () => null, NOW), null);
    assert.equal(await companyHiringRecord("none.example", async () => ({}) as CompanyExhaust, NOW), null);
  });
});

const weeks = [
  { weekStartIso: "2026-10-12", newListings: 4, firstTracked: false, inProgress: false },
  { weekStartIso: "2026-10-19", newListings: 2, firstTracked: false, inProgress: true },
];
const cadenceOf = (w: typeof weeks) => ({ data: { weeks: w }, source: "job_listings", label: "Job listings", asOf: new Date(NOW).toISOString() });

describe("the job page's record carries the weekly bars from the same read", () => {
  it("a company with cadence weeks: sentence and the bars the company page draws", async () => {
    const exhaust = { ...exhaustWith(6, 1, "2026-02-02T08:00:00Z"), cadence: cadenceOf(weeks) } as unknown as CompanyExhaust;
    const view = await companyHiringRecord("bar.example", async () => exhaust, NOW);
    assert.equal(view?.sentence, "Last 13 weeks: 6 roles opened, 1 closed.");
    assert.deepEqual(view?.cadence?.data.weeks, weeks);
  });

  it("integrity but zero weeks: the sentence alone, no empty chart", async () => {
    const exhaust = { ...exhaustWith(0, 2, "2026-02-02T08:00:00Z"), cadence: cadenceOf([]) } as unknown as CompanyExhaust;
    const view = await companyHiringRecord("flat.example", async () => exhaust, NOW);
    assert.equal(view?.sentence, "Last 13 weeks: 0 roles opened, 2 closed.");
    assert.equal(view?.cadence, null);
  });

  it("weeks without integrity facts: the bars alone", async () => {
    const view = await companyHiringRecord("bars.example", async () => ({ cadence: cadenceOf(weeks) }) as unknown as CompanyExhaust, NOW);
    assert.equal(view?.sentence, null);
    assert.equal(view?.cadence?.data.weeks.length, 2);
  });
});

describe("nothing in src reads the job-document 90-day aggregate", () => {
  // meilisearch.ts keeps the index-settings attribute names (filterable/sortable); no code reads the values.
  const SETTINGS_ONLY = new Set(["lib/jobs/meilisearch.ts"]);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });

  it("no source file (job page, meta, OG, chips included) names company_opened_90d / company_closed_90d", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((f) => !SETTINGS_ONLY.has(f.slice(root.length + 1)))
      .filter((f) => /company_(opened|closed)_90d/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1));
    assert.deepEqual(offenders, []);
  });
});
