/**
 * Covers the layer `identity-forget.test.ts` deliberately stubs out: the SQL
 * `deleteTelemetryByUserId` actually issues.
 *
 * That stub is why the 2026-09-03 privilege mismatch could sit undetected —
 * every test above this layer injected `deleteTelemetry`, so nothing ever
 * looked at the statement, and the statement was a bare DELETE issued on a
 * connection whose role is granted INSERT only. A test that asserts the SHAPE
 * of the query is the only thing that can catch that class.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { deleteTelemetryByUserId } from "../../src/lib/telemetry/store";

type Call = { sql: string; params: readonly unknown[] };

function recorder(result: unknown): { q: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const q: Queryable = {
    async query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [result] as R[] };
    },
  } as Queryable;
  return { q, calls };
}

describe("deleteTelemetryByUserId", () => {
  it("erases through the SECURITY DEFINER function, never a bare DELETE", async () => {
    const { q, calls } = recorder({ deleted: "2" });
    await deleteTelemetryByUserId(q, "uid-abc");

    assert.equal(calls.length, 1);
    const sql = calls[0].sql.toLowerCase();
    assert.match(sql, /intervu\.forget_telemetry_user/);
    // The privilege the ingest role does NOT hold. If this ever reappears the
    // statement will fail with permission-denied in production only.
    assert.doesNotMatch(sql, /\bdelete\s+from\b/);
  });

  it("binds the uid as a parameter rather than interpolating it", async () => {
    const { q, calls } = recorder({ deleted: "1" });
    await deleteTelemetryByUserId(q, "uid'; drop table intervu.telemetry_events; --");

    assert.deepEqual(calls[0].params, ["uid'; drop table intervu.telemetry_events; --"]);
    assert.doesNotMatch(calls[0].sql, /drop table/i);
    assert.match(calls[0].sql, /\$1/);
  });

  it("returns a number when pg hands back a bigint as a string", async () => {
    // A DIFFERENT failure class from the one that prompted this file: bigint
    // is serialised as a string by node-postgres, so a caller comparing the
    // result to 0 would read "0" as truthy and report a deletion that never
    // happened.
    const { q } = recorder({ deleted: "1204" });
    const n = await deleteTelemetryByUserId(q, "uid-abc");

    assert.equal(n, 1204);
    assert.equal(typeof n, "number");
  });

  it("reads a genuine zero as 0, not as a missing count", async () => {
    const { q } = recorder({ deleted: "0" });
    assert.equal(await deleteTelemetryByUserId(q, "uid-never-searched"), 0);
  });

  it("returns 0 rather than NaN when the row or column is absent", async () => {
    const q: Queryable = { async query() { return { rows: [] }; } } as unknown as Queryable;
    const n = await deleteTelemetryByUserId(q, "uid-abc");

    assert.equal(n, 0);
    assert.equal(Number.isNaN(n), false);
  });
});
