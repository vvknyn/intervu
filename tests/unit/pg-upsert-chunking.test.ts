import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_BIND_PARAMS, chunkRowsForBind, upsertRows } from "@/lib/pg/upsert";
import type { Queryable } from "@/lib/pg/pool";

interface NarrowRow {
  k: number;
  v: number;
}
interface WideRow {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
}

const NARROW = ["k", "v"] as const;
const WIDE = ["a", "b", "c", "d", "e", "f", "g"] as const;

function recordingDb(): Queryable & { calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  return {
    calls,
    async query<R>(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      return { rows: [] as R[] };
    },
  };
}

describe("chunkRowsForBind", () => {
  it("derives rows-per-chunk from the column count (6 columns, telemetry feature_outcomes shape)", () => {
    const rows = Array.from({ length: 13416 }, (_, i) => i); // 13416 x 6 = 80496 > 65535: the prod overflow
    const chunks = chunkRowsForBind(rows, 6);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, Math.floor(MAX_BIND_PARAMS / 6));
    assert.equal(chunks.flat().length, rows.length);
    for (const c of chunks) assert.ok(c.length * 6 <= MAX_BIND_PARAMS);
  });

  it("uses a different chunk size for a different column count (7 columns)", () => {
    const rows = Array.from({ length: 30000 }, (_, i) => i);
    const chunks = chunkRowsForBind(rows, 7);
    assert.equal(chunks[0].length, Math.floor(MAX_BIND_PARAMS / 7));
    assert.equal(chunks.length, Math.ceil(30000 / Math.floor(MAX_BIND_PARAMS / 7)));
    for (const c of chunks) assert.ok(c.length * 7 <= MAX_BIND_PARAMS);
  });

  it("keeps a batch at exactly the limit in one chunk, and returns no chunks for no rows", () => {
    assert.equal(chunkRowsForBind(Array(Math.floor(MAX_BIND_PARAMS / 5)).fill(0), 5).length, 1);
    assert.deepEqual(chunkRowsForBind([], 5), []);
  });

  it("fails loudly when one row alone cannot fit", () => {
    assert.throws(() => chunkRowsForBind([1], MAX_BIND_PARAMS + 1), /exceed/);
  });
});

describe("upsertRows", () => {
  it("splits an oversized narrow batch into statements that each stay under the bind limit, preserving order and count", async () => {
    const db = recordingDb();
    const rows: NarrowRow[] = Array.from({ length: 40000 }, (_, i) => ({ k: i, v: i * 2 })); // 80000 params
    const written = await upsertRows<NarrowRow>(db, "t_narrow", NARROW, ["k"], rows, ["computed_at"]);

    assert.equal(written, 40000);
    assert.equal(db.calls.length, 2);
    for (const call of db.calls) {
      assert.ok(call.params.length <= MAX_BIND_PARAMS);
      assert.match(call.text, /insert into t_narrow \(k, v\)/);
      assert.match(call.text, /computed_at = now\(\)/);
    }
    assert.deepEqual(
      db.calls.flatMap((c) => c.params),
      rows.flatMap((r) => [r.k, r.v]),
    );
  });

  it("chunks a batch with a different column count by that table's own width", async () => {
    const db = recordingDb();
    const rows: WideRow[] = Array.from({ length: 20000 }, (_, i) => ({ a: i, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0 })); // 140000 params
    await upsertRows<WideRow>(db, "t_wide", WIDE, ["a"], rows);

    const rowsPerChunk = Math.floor(MAX_BIND_PARAMS / 7);
    assert.equal(db.calls.length, Math.ceil(20000 / rowsPerChunk));
    assert.equal(db.calls[0].params.length, rowsPerChunk * 7);
    for (const call of db.calls) assert.ok(call.params.length <= MAX_BIND_PARAMS);
  });

  it("issues a single statement for a small batch and none for an empty one", async () => {
    const db = recordingDb();
    assert.equal(await upsertRows<NarrowRow>(db, "t", NARROW, ["k"], [{ k: 1, v: 1 }]), 1);
    assert.equal(db.calls.length, 1);
    assert.equal(await upsertRows<NarrowRow>(db, "t", NARROW, ["k"], []), 0);
    assert.equal(db.calls.length, 1);
  });
});
