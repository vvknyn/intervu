import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchRollupEvents, resolveWindowDays } from "@/lib/telemetry/rollup-fetch";
import type { Queryable } from "@/lib/pg/pool";

/**
 * `fetchRollupEvents` is called with two window sizes:
 * `job_daily`/`company_daily`'s short `--window-days` and
 * `feature_outcomes`'s full-retention `--feature-window-days` — see
 * roll-up-telemetry.ts's module doc. A fake `Queryable` (same pattern
 * `tests/unit/company-exhaust.test.ts` uses) drives it without a live
 * database: each call records the SQL + params it received and returns
 * rows keyed to the `windowDays` param it was asked for, so the test can
 * tell which window's fetch produced which rows.
 */
function fakeDb(rowsByWindow: Record<number, Record<string, unknown>[]>): {
  db: Queryable;
  calls: { text: string; params: unknown[] }[];
} {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <R>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      const windowDays = params[0] as number;
      const isImpressionsQuery = text.includes("jsonb_array_elements_text");
      // Only the scalar-events query returns rows here; the impressions
      // query always returns none — keeps each fake window's fixture rows
      // unambiguous (one row shape, one source) without asserting on
      // impressions in these tests.
      const rows = isImpressionsQuery ? [] : (rowsByWindow[windowDays] ?? []);
      return { rows: rows as R[] };
    },
  };
  return { db, calls };
}

describe("resolveWindowDays", () => {
  it("defaults when the flag is absent", () => {
    assert.equal(resolveWindowDays([], "window-days", 2), 2);
  });

  it("parses the flag when present", () => {
    assert.equal(resolveWindowDays(["--feature-window-days=45"], "feature-window-days", 90), 45);
  });

  it("rejects a non-numeric value loudly instead of rolling up NaN days", () => {
    assert.throws(
      () => resolveWindowDays(["--window-days=abc"], "window-days", 2),
      /--window-days must be a positive number, got --window-days=abc/,
    );
  });

  it("rejects zero and negative values", () => {
    assert.throws(() => resolveWindowDays(["--window-days=0"], "window-days", 2), /positive number/);
    assert.throws(() => resolveWindowDays(["--window-days=-3"], "window-days", 2), /positive number/);
  });
});

describe("fetchRollupEvents — window reuse", () => {
  it("equal windows: fetches once and reuses the same rows for both tables' aggregation", async () => {
    const { db, calls } = fakeDb({
      2: [{ event_name: "result_clicked", day: "2026-09-03", job_id: "j1", company_domain: null, position: 1 }],
    });

    const { dailyEvents, featureEvents } = await fetchRollupEvents(db, 2, 2);

    // Exactly one (scalar, impressions) pair — not a second pair for the
    // "same" wider window.
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => c.params),
      [[2], [2]],
    );
    // Reused, not independently recomputed: same array reference.
    assert.equal(dailyEvents, featureEvents);
    assert.equal(dailyEvents.length, 1);
  });

  it("wider feature window: the feature aggregation sees rows the daily aggregation does not", async () => {
    const oldRow = { event_name: "apply_clicked", day: "2026-08-01", job_id: "j-old", company_domain: null, position: 4 };
    const recentRow = { event_name: "apply_clicked", day: "2026-09-03", job_id: "j-recent", company_domain: null, position: 2 };
    const { db, calls } = fakeDb({
      2: [recentRow],
      90: [oldRow, recentRow],
    });

    const { dailyEvents, featureEvents } = await fetchRollupEvents(db, 2, 90);

    // Two independent (scalar, impressions) pairs — one per window.
    assert.equal(calls.length, 4);

    const dailyJobIds = dailyEvents.map((e) => e.job_id);
    const featureJobIds = featureEvents.map((e) => e.job_id);
    assert.deepEqual(dailyJobIds, ["j-recent"]);
    assert.deepEqual(featureJobIds.sort(), ["j-old", "j-recent"]);
    // The defining assertion: the older row reaches the feature aggregation
    // but never the daily one.
    assert.ok(featureJobIds.includes("j-old"));
    assert.ok(!dailyJobIds.includes("j-old"));
  });
});
