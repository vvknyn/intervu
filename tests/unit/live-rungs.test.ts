import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dropDeadRungs, keepZdrRungs, liveRungs, resetLiveCatalog, CATALOG_TTL_MS } from "@/lib/llm/live-rungs";
import { resolveModelLadder } from "@/lib/llm/model-ladder";

const PAID = "vendor/paid";
const rungs = resolveModelLadder({ provider: "openrouter", model: PAID }, ["a/live:free", "b/gone:free", "c/live:free"]);
const ALL_ZDR = async () => new Set(["a/live:free", "b/gone:free", "c/live:free", PAID]);
const names = (r: { model: string }[]) => r.map((x) => x.model);

beforeEach(resetLiveCatalog);

test("a free rung absent from the catalog is dropped, order preserved", () => {
    assert.deepEqual(names(dropDeadRungs(rungs, new Set(["a/live:free", "c/live:free", PAID]))), ["a/live:free", "c/live:free", PAID]);
});

test("the paid tail is kept even when the catalog does not list it", () => {
    assert.deepEqual(names(dropDeadRungs(rungs, new Set(["a/live:free"]))), ["a/live:free", PAID]);
});

test("unknown catalog keeps every rung", () => {
    assert.deepEqual(names(dropDeadRungs(rungs, null)), names(rungs));
});

test("liveRungs: fetch failure keeps the ladder and is retried next call", async () => {
    let calls = 0;
    const load = async () => {
        calls++;
        throw new Error("boom");
    };
    assert.deepEqual(names(await liveRungs(rungs, load, 0, ALL_ZDR)), names(rungs));
    await liveRungs(rungs, load, 1, ALL_ZDR);
    assert.equal(calls, 2);
});

test("liveRungs: catalog fetched once within the TTL, again after it", async () => {
    let calls = 0;
    const load = async () => {
        calls++;
        return new Set(["a/live:free", PAID]);
    };
    assert.deepEqual(names(await liveRungs(rungs, load, 0, ALL_ZDR)), ["a/live:free", PAID]);
    await liveRungs(rungs, load, CATALOG_TTL_MS - 1, ALL_ZDR);
    assert.equal(calls, 1);
    await liveRungs(rungs, load, CATALOG_TTL_MS + 1, ALL_ZDR);
    assert.equal(calls, 2);
});

test("keepZdrRungs keeps models with a ZDR endpoint and drops the rest", () => {
    const r = resolveModelLadder({ provider: "openrouter", model: "x/paid-no" }, ["m/zdr-1", "n/no-zdr-1", "o/zdr-2", "p/no-zdr-2"]);
    assert.deepEqual(names(keepZdrRungs(r, new Set(["m/zdr-1", "o/zdr-2"]))), ["m/zdr-1", "o/zdr-2"]);
});

test("liveRungs: ZDR list unavailable yields no rungs; it is retried next call", async () => {
    let calls = 0;
    const bad = async () => {
        calls++;
        throw new Error("zdr down");
    };
    assert.deepEqual(await liveRungs(rungs, async () => new Set(names(rungs)), 0, bad), []);
    await liveRungs(rungs, async () => new Set(names(rungs)), 1, bad);
    assert.equal(calls, 2);
});

test("liveRungs applies catalog and ZDR filters together", async () => {
    const out = await liveRungs(rungs, async () => new Set(["a/live:free", "c/live:free", PAID]), 0, async () => new Set(["c/live:free", "b/gone:free"]));
    assert.deepEqual(names(out), ["c/live:free"]);
});
