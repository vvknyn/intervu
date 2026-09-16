import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildUpsert } from "@/lib/pg/upsert";

/**
 * `buildUpsert<T extends object>` must accept `interface`-typed rows, not
 * just `type` aliases. A TypeScript `interface` gets no implicit index
 * signature, so a stricter constraint like `Record<string, unknown>`
 * rejects it with TS2344 — invisible at runtime, only caught by
 * `tsc --noEmit`. This is a regression guard: if the constraint is ever
 * tightened back to `Record<string, unknown>`, this file fails to
 * typecheck.
 */
interface WidgetRow {
  widget_id: string;
  count: number;
  updated_at: string;
}

describe("buildUpsert", () => {
  it("accepts an interface-typed row and builds the expected SQL + params", () => {
    const rows: WidgetRow[] = [
      { widget_id: "w1", count: 3, updated_at: "2026-09-04" },
      { widget_id: "w2", count: 5, updated_at: "2026-09-04" },
    ];

    const { text, params } = buildUpsert<WidgetRow>(
      "widget_daily",
      ["widget_id", "count", "updated_at"],
      ["widget_id"],
      rows,
    );

    assert.match(text, /insert into widget_daily \(widget_id, count, updated_at\)/);
    assert.match(text, /values \(\$1, \$2, \$3\), \(\$4, \$5, \$6\)/);
    assert.match(text, /on conflict \(widget_id\) do update set count = excluded\.count, updated_at = excluded\.updated_at/);
    assert.deepEqual(params, ["w1", 3, "2026-09-04", "w2", 5, "2026-09-04"]);
  });

  it("omitting touchColumns leaves the generated SQL byte-identical to the no-touch output", () => {
    const rows: WidgetRow[] = [{ widget_id: "w1", count: 3, updated_at: "2026-09-04" }];
    const columns = ["widget_id", "count", "updated_at"] as const;
    const conflict = ["widget_id"] as const;

    const withoutArg = buildUpsert<WidgetRow>("widget_daily", columns, conflict, rows);
    const withEmptyArray = buildUpsert<WidgetRow>("widget_daily", columns, conflict, rows, []);

    assert.equal(withoutArg.text, withEmptyArray.text);
    assert.deepEqual(withoutArg.params, withEmptyArray.params);
    // No "now()" anywhere in the fast path's output.
    assert.doesNotMatch(withoutArg.text, /now\(\)/);
  });

  it("touchColumns appends `<col> = now()` to the update set, on a table outside the three known callers", () => {
    // widget_daily is not job_daily/company_daily/feature_outcomes — this is
    // the class case: any caller passing touchColumns gets the behavior,
    // not just the three roll-up-telemetry.ts call sites.
    const rows: WidgetRow[] = [{ widget_id: "w1", count: 3, updated_at: "2026-09-04" }];

    const { text, params } = buildUpsert<WidgetRow>(
      "widget_daily",
      ["widget_id", "count", "updated_at"],
      ["widget_id"],
      rows,
      ["computed_at"],
    );

    assert.match(
      text,
      /on conflict \(widget_id\) do update set count = excluded\.count, updated_at = excluded\.updated_at, computed_at = now\(\)/,
    );
    // Not part of the insert column list.
    assert.doesNotMatch(text, /insert into widget_daily \([^)]*computed_at/);
    // Not part of params — still exactly the 3 data-column values.
    assert.deepEqual(params, ["w1", 3, "2026-09-04"]);
  });

  it("matches the real roll-up-telemetry.ts call shape: job_daily/company_daily/feature_outcomes touch computed_at", () => {
    interface JobDailyRowLike {
      job_id: string;
      day: string;
      impressions: number;
    }
    const rows: JobDailyRowLike[] = [{ job_id: "j1", day: "2026-09-04", impressions: 5 }];

    const { text } = buildUpsert<JobDailyRowLike>(
      "intervu.job_daily",
      ["job_id", "day", "impressions"],
      ["job_id", "day"],
      rows,
      ["computed_at"],
    );

    assert.match(text, /do update set impressions = excluded\.impressions, computed_at = now\(\)/);
  });
});
