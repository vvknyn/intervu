import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateQueryDaily, toQueryDailyRows, type QueryDailyEventRow } from "../../src/lib/telemetry/query-daily";

// Fixture only — never prod. `query_normalized` values below are synthetic
// test tokens, not sampled real user search text (the "q is raw user search
// text, never printed" rule applies to prod data, not to made-up fixture
// strings, but this file still avoids anything that reads like a real
// query for that reason).
function event(overrides: Partial<QueryDailyEventRow>): QueryDailyEventRow {
  return {
    query_normalized: "fixture-query",
    day: "2026-08-01",
    result_count: 1,
    open_count: 0,
    ...overrides,
  };
}

describe("aggregateQueryDaily — one query on two different days", () => {
  it("produces two separate (query_normalized, day) groups, each counted independently", () => {
    const events: QueryDailyEventRow[] = [
      event({ day: "2026-08-01" }),
      event({ day: "2026-08-01" }),
      event({ day: "2026-08-02" }),
    ];
    const byGroup = aggregateQueryDaily(events);
    assert.equal(byGroup.size, 2);
    assert.equal(byGroup.get("fixture-query|2026-08-01")!.searches, 2);
    assert.equal(byGroup.get("fixture-query|2026-08-02")!.searches, 1);
  });
});

describe("aggregateQueryDaily — zero-result search", () => {
  it("counts result_count === 0 into zero_result_count, and a non-zero result into neither", () => {
    const events: QueryDailyEventRow[] = [
      event({ result_count: 0 }),
      event({ result_count: 5 }),
    ];
    const metrics = aggregateQueryDaily(events).get("fixture-query|2026-08-01")!;
    assert.equal(metrics.searches, 2);
    assert.equal(metrics.zero_result_count, 1);
  });
});

describe("aggregateQueryDaily — click-through counts SEARCHES, not opens", () => {
  // The bug this fixture exists to catch: a search opened twice is still ONE
  // search that got a click-through, the same way a job page visited twice
  // isn't two "clicks" on the search that led there. If aggregateQueryDaily
  // ever summed open_count instead of testing open_count > 0, this same
  // fixture would report click_through_count = 2 for a single search — see
  // the red→green transition captured alongside this change.
  it("a search with two search_opens rows (open_count: 2) counts as ONE click-through", () => {
    const events: QueryDailyEventRow[] = [event({ open_count: 2 })];
    const metrics = aggregateQueryDaily(events).get("fixture-query|2026-08-01")!;
    assert.equal(metrics.searches, 1);
    assert.equal(metrics.click_through_count, 1);
  });

  it("a search with zero opens contributes zero click-throughs", () => {
    const events: QueryDailyEventRow[] = [event({ open_count: 0 })];
    const metrics = aggregateQueryDaily(events).get("fixture-query|2026-08-01")!;
    assert.equal(metrics.click_through_count, 0);
  });

  it("two distinct searches each with one open both count, giving click_through_count 2 for TWO searches (not conflated with the two-opens-one-search case above)", () => {
    const events: QueryDailyEventRow[] = [event({ open_count: 1 }), event({ open_count: 1 })];
    const metrics = aggregateQueryDaily(events).get("fixture-query|2026-08-01")!;
    assert.equal(metrics.searches, 2);
    assert.equal(metrics.click_through_count, 2);
  });
});

describe("aggregateQueryDaily — empty query_normalized (default-browse) is excluded", () => {
  it("a row with query_normalized '' contributes no group at all, even mixed in with typed searches", () => {
    const events: QueryDailyEventRow[] = [
      event({ query_normalized: "" }),
      event({ query_normalized: "" }),
      event({ query_normalized: "fixture-query" }),
    ];
    const byGroup = aggregateQueryDaily(events);
    assert.equal(byGroup.size, 1);
    assert.equal(byGroup.has("|2026-08-01"), false);
    assert.equal(byGroup.get("fixture-query|2026-08-01")!.searches, 1);
  });
});

describe("toQueryDailyRows — round-trips the group key back into (query_normalized, day) columns", () => {
  it("splits the '<query>|<day>' key using the same splitGroupKey daily-rollup.ts uses", () => {
    const rows = toQueryDailyRows(aggregateQueryDaily([event({ query_normalized: "two words", day: "2026-08-03" })]));
    assert.deepEqual(rows, [
      { query_normalized: "two words", day: "2026-08-03", searches: 1, zero_result_count: 0, click_through_count: 0 },
    ]);
  });
});
