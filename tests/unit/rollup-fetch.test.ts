import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchRollupEvents,
  fetchWindowEvents,
  fetchWindowImpressions,
  resolveWindowDays,
} from "@/lib/telemetry/rollup-fetch";
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

describe("fetchWindowEvents / fetchWindowImpressions — UTC day-snapped lower bound", () => {
  it("both queries bound on date_trunc('day', now(), 'UTC') minus the window, not a raw now() instant", async () => {
    const capturedTexts: string[] = [];
    const db: Queryable = {
      query: async <R>(text: string) => {
        capturedTexts.push(text);
        return { rows: [] as R[] };
      },
    };

    await fetchWindowEvents(db, 5);
    await fetchWindowImpressions(db, 5);

    assert.equal(capturedTexts.length, 2);
    for (const text of capturedTexts) {
      const boundLine = text.split("\n").find((line) => line.includes(">="));
      assert.ok(boundLine, `expected a lower-bound line in:\n${text}`);
      // Exact required form: the three-arg date_trunc, not
      // `now() at time zone 'utc'` (returns a naive timestamp compared in
      // the session's own timezone) and not a bare `now() - make_interval`
      // (the pre-fix instant-based bound this replaces).
      assert.match(boundLine!, /date_trunc\('day', now\(\), 'UTC'\) - make_interval\(days => \$1\)/);
    }
  });
});

describe("window lower bound — day-snap fixes a real truncation, for any 'now'", () => {
  // Postgres computes the actual bound server-side (`date_trunc('day',
  // now(), 'UTC')`), so a unit test with no live database cannot execute
  // it. These two mirrors reproduce the OLD and NEW formulas in plain UTC
  // Date math, purely to demonstrate the class of bug the day-snap fixes —
  // the SQL-text assertion above, not these mirrors, is what pins the
  // actual query to the required form.
  function newDaySnappedBound(now: Date, windowDays: number): Date {
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(utcMidnight - windowDays * 24 * 60 * 60 * 1000);
  }
  function oldInstantBound(now: Date, windowDays: number): Date {
    return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  }

  it("the new bound lands on a UTC midnight for any 'now' and any window size (class case)", () => {
    const nowSamples = [
      new Date("2026-01-15T00:00:00.001Z"),
      new Date("2026-03-02T11:47:33.000Z"),
      new Date("2026-07-31T23:59:59.999Z"),
      new Date("2026-11-09T06:00:00.000Z"),
    ];
    const windowDaysSamples = [1, 3, 7, 90];
    for (const now of nowSamples) {
      for (const windowDays of windowDaysSamples) {
        const bound = newDaySnappedBound(now, windowDays);
        assert.equal(bound.getUTCHours(), 0);
        assert.equal(bound.getUTCMinutes(), 0);
        assert.equal(bound.getUTCSeconds(), 0);
        assert.equal(bound.getUTCMilliseconds(), 0);
      }
    }
  });

  it("the old instant-based bound truncates the early hours of the oldest day -- the exact defect the snap fixes", () => {
    // A representative cron start time, not today's date and not
    // windowDays=2 -- any non-midnight 'now' reproduces this class of bug.
    const now = new Date("2026-05-20T09:15:00.000Z");
    const windowDays = 4;

    const newBound = newDaySnappedBound(now, windowDays);
    const oldBound = oldInstantBound(now, windowDays);

    // An event just after UTC midnight on the oldest day the window is
    // supposed to cover IN FULL.
    const earlyEventOnOldestDay = new Date(newBound.getTime() + 5 * 60 * 1000);

    assert.ok(
      earlyEventOnOldestDay >= newBound,
      "day-snapped bound must include the oldest day's early hours",
    );
    assert.ok(
      earlyEventOnOldestDay < oldBound,
      "the old instant-based bound excludes the same event -- proving it truncated the oldest day",
    );
  });
});
