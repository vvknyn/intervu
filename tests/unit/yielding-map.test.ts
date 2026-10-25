import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapYielding } from "@/lib/perf/yielding-map";

/** Burns `ms` of CPU without yielding, as a slow synchronous item does. */
const busyFor = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe("mapYielding", () => {
  it("lets a timer set before the call fire before the call resolves once the work passes the budget", async () => {
    let fired = false;
    setTimeout(() => (fired = true), 0);
    await mapYielding([1, 2, 3, 4], () => busyFor(15), 20);
    assert.equal(fired, true);
  });

  it("does not yield while the work stays within the budget", async () => {
    let fired = false;
    setImmediate(() => (fired = true));
    await mapYielding([1, 2, 3], (n) => n, 1_000);
    assert.equal(fired, false);
  });

  it("keeps the order of the items and passes the index", async () => {
    const out = await mapYielding(["a", "b", "c", "d"], (item, i) => (busyFor(10), `${i}${item}`), 15);
    assert.deepEqual(out, ["0a", "1b", "2c", "3d"]);
  });

  it("returns an empty array for no items", async () => {
    assert.deepEqual(await mapYielding([], () => 1), []);
  });

  it("rejects with what the item function throws", async () => {
    await assert.rejects(() => mapYielding([1, 2], () => { throw new Error("bad row"); }), /bad row/);
  });
});
