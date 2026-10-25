/**
 * One slow box statement must not void every box-fed section: at the deadline
 * each section renders if its own query has answered, and a piece still out is
 * absent (null), never zero or empty. Only a complete read is cached.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readCompanyExhaust, type CompanyExhaust } from "../../src/lib/companies/exhaust";
import { createExhaustCache } from "../../src/lib/companies/exhaust-cache";
import { buildCompanyFacts } from "../../src/lib/companies/company-facts";
import type { Queryable } from "../../src/lib/pg/pool";

const NOW = Date.parse("2026-08-27T00:00:00Z");
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Each statement is recognised by a SQL fragment, answers canned rows, and takes `delays[key]` ms. */
const STATEMENTS: Record<string, { match: string; rows: unknown[] }> = {
  enrichment: { match: "company_enrichment", rows: [] },
  health: { match: "health_verdict", rows: [{ health_verdict: "healthy", health_score: 80, job_repost_rate: 0.1, operating_status: "active", created_at: "2026-01-01T00:00:00Z", last_checked_at: null }] },
  sector: { match: "AS careers_url", rows: [{ health_reviews: "software", fingerprints: null, boards: null, careers_url: "https://acme.com/careers" }] },
  changes: { match: "company_change_events", rows: [{ event_type: "layoff", direction: "down", title: "Cut", occurred_at: "2026-08-01T00:00:00Z", confidence: 0.9 }] },
  closed: { match: "closed_reason", rows: [{ closed_reason: "filled", n: 3 }] },
  weeks: { match: "wk.week_start", rows: [{ week_start: null, total: null, first_day: "2026-01-05" }] },
};

function fakePg(delays: Partial<Record<keyof typeof STATEMENTS, number>> = {}): Queryable {
  return {
    query: async (sql: string) => {
      const [key, spec] = Object.entries(STATEMENTS).find(([, s]) => sql.includes(s.match)) ?? [];
      assert.ok(key && spec, `unrecognised statement: ${sql.slice(0, 60)}`);
      await wait(delays[key as keyof typeof STATEMENTS] ?? 0);
      return { rows: spec.rows };
    },
  } as unknown as Queryable;
}

function cacheOver(pg: Queryable) {
  let reads = 0;
  const get = createExhaustCache((domain, onPartial) => {
    reads += 1;
    return readCompanyExhaust(domain, () => pg, NOW, onPartial);
  });
  return { get, reads: () => reads };
}

const DEADLINE = 80;
const SLOW = 300;

describe("a slow statement voids only its own sections at the deadline", () => {
  it("slow closed-reasons query: record and cadence absent; sector, careers, health, changes present", async () => {
    const { get } = cacheOver(fakePg({ closed: SLOW }));
    const x = (await get("acme.com", DEADLINE)) as CompanyExhaust;
    assert.equal(x.cadence, null);
    assert.equal(x.integrity, null);
    assert.ok(x.sector);
    assert.equal(x.careersUrl, "https://acme.com/careers");
    assert.equal(x.health?.data.verdict, "healthy");
    assert.equal(x.changeHistory?.data.length, 1);
    const facts = buildCompanyFacts({ name: "Acme", domain: "acme.com", jobs: [], openCount: { value: 0, isLowerBound: false }, postingTotal: 0, exhaust: x });
    assert.equal(facts.hiring.cadence, null);
    assert.equal(facts.hiring.monitoredSince, null);
  });

  it("another slow statement (health): only health is absent", async () => {
    const { get } = cacheOver(fakePg({ health: SLOW }));
    const x = (await get("acme.com", DEADLINE)) as CompanyExhaust;
    assert.equal(x.health, null);
    assert.ok(x.cadence && x.integrity && x.sector && x.changeHistory);
  });

  it("all fast: identical to the complete read", async () => {
    const pg = fakePg();
    const x = await cacheOver(pg).get("acme.com", DEADLINE);
    assert.deepEqual(x, (await readCompanyExhaust("acme.com", () => pg, NOW)).exhaust);
    assert.ok(x?.cadence && x.integrity);
  });

  it("all slow: null, as before", async () => {
    const slow = Object.fromEntries(Object.keys(STATEMENTS).map((k) => [k, SLOW]));
    assert.equal(await cacheOver(fakePg(slow)).get("acme.com", DEADLINE), null);
  });

  it("the slow read completes later: the cache holds the complete entry, with no second read", async () => {
    const { get, reads } = cacheOver(fakePg({ closed: SLOW }));
    await get("acme.com", DEADLINE);
    await wait(SLOW + 100);
    const x = (await get("acme.com", DEADLINE)) as CompanyExhaust;
    assert.ok(x.cadence && x.integrity);
    assert.equal(reads(), 1);
  });

  it("a visit with no deadline still waits for the whole read", async () => {
    const x = (await cacheOver(fakePg({ closed: 150 })).get("acme.com")) as CompanyExhaust;
    assert.ok(x.cadence && x.integrity);
  });
});

describe("getCompanyPageData with the real cache", () => {
  it("a slow record leaves off only the record: sector and careers still reach the page", async () => {
    const { getCompanyPageData } = await import("../../src/lib/companies/get-company");
    const { get } = cacheOver(fakePg({ closed: SLOW }));
    const job = { id: "1", title: "Eng", company: "Acme", company_domain: "acme.com", vacancy_status: "open", ghost_badge: "clear", tags: [] };
    const search = async () => ({ hits: [job], total: 1, backend: "meilisearch", configured: true });
    const data = await getCompanyPageData("acme--com", search as never, {
      news: async () => [], events: async () => [], directory: (async () => null) as never, exhaust: get,
      sideTimeoutMs: DEADLINE, budgetMs: 1_000, log: () => {},
    });
    assert.ok(data?.exhaust?.sector && data.exhaust.careersUrl);
    assert.equal(data?.exhaust?.integrity, null);
    assert.equal(data?.facts.hiring.cadence, null);
  });
});

describe("the page's backstop fires after the box read's own deadline", () => {
  it("a read that ignores the deadline is still left off, one margin later", async () => {
    const { getCompanyPageData, BOX_BACKSTOP_MARGIN_MS } = await import("../../src/lib/companies/get-company");
    assert.ok(BOX_BACKSTOP_MARGIN_MS > 0);
    const job = { id: "1", title: "Eng", company: "Acme", company_domain: "acme.com", vacancy_status: "open", ghost_badge: "clear", tags: [] };
    const search = async () => ({ hits: [job], total: 1, backend: "meilisearch", configured: true });
    const t0 = Date.now();
    const data = await getCompanyPageData("acme--com", search as never, {
      news: async () => [], events: async () => [], directory: (async () => null) as never,
      exhaust: async () => { await wait(DEADLINE + BOX_BACKSTOP_MARGIN_MS + 100); return {} as CompanyExhaust; },
      sideTimeoutMs: DEADLINE, budgetMs: 1_000, log: () => {},
    });
    assert.equal(data?.exhaust, null);
    assert.ok(Date.now() - t0 < DEADLINE + BOX_BACKSTOP_MARGIN_MS + 90);
  });
});
