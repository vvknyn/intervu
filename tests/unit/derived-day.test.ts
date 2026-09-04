import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { utcDayColumnSql, UTC_DAY_TRUNC_NOW_SQL } from "../../src/lib/telemetry/derived-day";

/**
 * `derived-day.ts` is the ONE place every `intervu.*_daily` table's day
 * bucketing is spelled out — see that module's doc for why (a Berlin vs.
 * UTC day column silently misaligns cross-table joins at every boundary).
 * These tests pin the exact SQL text it emits, so a future edit that
 * changes the timezone literal (the actual regression class this file
 * exists to catch — an earlier version of query-daily-fetch.ts did exactly
 * this, hardcoding 'Europe/Berlin') fails here immediately, not silently
 * three call sites downstream.
 */
describe("utcDayColumnSql — the day-bucketing fragment shared by job_daily/company_daily/query_daily", () => {
  it("renders to_char(<column> at time zone 'utc', 'YYYY-MM-DD') for a bare column", () => {
    assert.equal(utcDayColumnSql("received_at"), "to_char(received_at at time zone 'utc', 'YYYY-MM-DD')");
  });

  it("accepts a cast expression verbatim, e.g. query-daily-fetch.ts's search_events cast", () => {
    assert.equal(
      utcDayColumnSql("s.created_at::timestamptz"),
      "to_char(s.created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD')",
    );
  });

  // THE BOUNDARY CASE this whole change is about. Verified directly
  // against live Postgres (read-only, a literal constant — no table
  // touched), 2026-09-04:
  //   select to_char('2026-08-23T23:30:00Z'::timestamptz at time zone 'utc', 'YYYY-MM-DD'),
  //          to_char('2026-08-23T23:30:00Z'::timestamptz at time zone 'Europe/Berlin', 'YYYY-MM-DD')
  //   -> utc_day = "2026-08-23", berlin_day = "2026-08-24"
  // 23:30 UTC is still 2026-08-23 in UTC but has already rolled into
  // 2026-08-24 in Europe/Berlin (UTC+2 in August) — this exact disagreement
  // is what turned the original "786 pairs" reconciliation target into a
  // wrong number (793 is correct). A unit test with no live database
  // cannot execute that Postgres date/timezone arithmetic itself, so what
  // this asserts is the part within reach: the fragment wired into every
  // call site names the zone as 'utc' literally, never 'Europe/Berlin' or
  // any other zone — the one thing a future edit could get wrong and
  // silently reintroduce the boundary disagreement measured above.
  it("names the zone as 'utc' literally, not Europe/Berlin or any other zone", () => {
    assert.match(utcDayColumnSql("x"), /at time zone 'utc'/);
    assert.doesNotMatch(utcDayColumnSql("x"), /Europe\/Berlin/);
  });
});

describe("UTC_DAY_TRUNC_NOW_SQL — the window lower-bound snap shared by job_daily/company_daily", () => {
  it("is the three-arg date_trunc(..., 'UTC') form, not now() at time zone 'utc'", () => {
    // The three-arg form is required: `now() at time zone 'utc'` returns a
    // NAIVE timestamp compared in the session's own timezone, silently
    // reintroducing the same class of bug for window bounds instead of day
    // labels — see rollup-fetch.ts's module doc.
    assert.equal(UTC_DAY_TRUNC_NOW_SQL, "date_trunc('day', now(), 'UTC')");
  });
});
