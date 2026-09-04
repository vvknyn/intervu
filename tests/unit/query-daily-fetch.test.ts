import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Queryable } from "@/lib/pg/pool";
import { fetchQueryDailyEvents } from "@/lib/telemetry/query-daily-fetch";

/**
 * Wiring + boundary proof for the query_daily lane — the counterpart to
 * `tests/unit/rollup-fetch.test.ts`'s job_daily/company_daily assertions and
 * `tests/unit/derived-day.test.ts`'s helper-level tests. Same boundary
 * instant (2026-08-23T23:30:00Z, UTC day 2026-08-23 vs. Europe/Berlin day
 * 2026-08-24, cross-checked against live Postgres 2026-09-04 — see
 * derived-day.ts's module doc) governs all three lanes through one shared
 * helper; this file is what proves the query lane is actually wired to it,
 * not an independently-typed copy that could silently name a different zone.
 */
describe("fetchQueryDailyEvents — UTC day LABEL, query_daily lane", () => {
  it("day column is to_char(s.created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD')", async () => {
    let capturedText = "";
    const db: Queryable = {
      query: async <R>(text: string) => {
        capturedText = text;
        return { rows: [] as R[] };
      },
    };
    await fetchQueryDailyEvents(db);
    // Hardcoded literal, NOT a call through `utcDayColumnSql` imported from
    // the same module this asserts against — that would let both sides
    // drift together if derived-day.ts's zone literal ever regressed,
    // silently passing (the "two legs sharing an assumption" failure mode).
    // This must independently break if the shared helper stops emitting UTC.
    assert.ok(capturedText.includes(`to_char(s.created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD') as day`));
  });
});
