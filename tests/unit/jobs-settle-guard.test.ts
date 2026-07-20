import { test } from "node:test";
import assert from "node:assert/strict";
import { withSettleGuard } from "../../src/lib/jobs/settle-guard";

const delay = <T>(v: T, ms: number): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Phase 1-a #2: a promise that settles well within the guard resolves
// normally, carrying its real value through untouched.
test("withSettleGuard resolves normally when the wrapped promise settles in time", async () => {
    const result = await withSettleGuard(delay("ok", 5), 200);
    assert.equal(result, "ok");
});

// The failure this exists for: a Server Action POST that never resolves or
// rejects (an edge-level 503 invisible to app code). The guard must reject
// rather than hang forever, so callers' existing catch-based error handling
// fires.
test("withSettleGuard rejects when the wrapped promise never settles", async () => {
    const neverSettles = new Promise(() => {});
    await assert.rejects(() => withSettleGuard(neverSettles, 20));
});

test("withSettleGuard passes through a genuine rejection from the wrapped promise", async () => {
    const rejects = Promise.reject(new Error("boom"));
    await assert.rejects(() => withSettleGuard(rejects, 200), /boom/);
});
