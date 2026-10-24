import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlanCache } from "../../src/lib/account/plan";

describe("createPlanCache", () => {
    it("a rejected read is an error, never free", async () => {
        const read = createPlanCache(() => Promise.reject(new Error("down")));
        assert.deepEqual(await read(), { error: "Couldn't load your plan" });
    });
    it("memoises within 30 s and reads again after", async () => {
        let t = 0;
        let calls = 0;
        const read = createPlanCache(async () => ({ plan: { status: "free" as const }, n: ++calls }), () => t);
        await read();
        t = 29_999;
        await read();
        assert.equal(calls, 1);
        t = 30_000;
        await read();
        assert.equal(calls, 2);
    });
});
