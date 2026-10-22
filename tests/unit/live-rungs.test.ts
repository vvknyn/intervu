import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dropDeadRungs, liveRungs, resetLiveCatalog, CATALOG_TTL_MS } from "@/lib/llm/live-rungs";
import { resolveModelLadder } from "@/lib/llm/model-ladder";

const PAID = "vendor/paid";
const rungs = resolveModelLadder({ provider: "openrouter", model: PAID }, ["a/live:free", "b/gone:free", "c/live:free"]);
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
    assert.deepEqual(names(await liveRungs(rungs, load, 0)), names(rungs));
    await liveRungs(rungs, load, 1);
    assert.equal(calls, 2);
});

test("liveRungs: catalog fetched once within the TTL, again after it", async () => {
    let calls = 0;
    const load = async () => {
        calls++;
        return new Set(["a/live:free", PAID]);
    };
    assert.deepEqual(names(await liveRungs(rungs, load, 0)), ["a/live:free", PAID]);
    await liveRungs(rungs, load, CATALOG_TTL_MS - 1);
    assert.equal(calls, 1);
    await liveRungs(rungs, load, CATALOG_TTL_MS + 1);
    assert.equal(calls, 2);
});
