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

// The id-scoped detail path used to need its own, larger settle budget here
// (a never-settles guard PLUS the full description-fill deadline stacked on
// top). That path moved off this file entirely (2026-09-18, `perf(jobs):
// hydrate descriptions via GET route` — see this file's own doc comment):
// it now runs through `GET /api/jobs/[id]/description`, which owns its own
// `DETAIL_FETCH_TIMEOUT_MS` deadline (lib/jobs/detail-fetch.ts) instead of a
// second settle-guard budget. `withSettleGuard`/`ACTION_SETTLE_TIMEOUT_MS`
// above are exercised only by the remaining list-search actions, which
// never had this stacked-deadline problem.
