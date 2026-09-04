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
});
