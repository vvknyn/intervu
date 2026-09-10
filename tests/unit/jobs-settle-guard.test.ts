import { test } from "node:test";
import assert from "node:assert/strict";
import { withSettleGuard, ACTION_SETTLE_TIMEOUT_MS, DETAIL_SETTLE_TIMEOUT_MS } from "../../src/lib/jobs/settle-guard";
import { DESCRIPTION_FILL_VISIBLE_DEADLINE_MS } from "../../src/lib/jobs/fill-description";

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

// The detail budget must cover BOTH the never-settles guard AND the full
// server-side description-fill deadline on top of it — an id lookup can
// legitimately block for the fill deadline in addition to whatever the
// never-settles guard already accounts for. Asserted as a relationship
// against the two source constants, never a literal copied from
// settle-guard.ts, so this fails the moment either budget changes without
// the other being reconsidered.
test("DETAIL_SETTLE_TIMEOUT_MS covers the never-settles guard plus the full description-fill deadline", () => {
    assert.ok(
        DETAIL_SETTLE_TIMEOUT_MS >= ACTION_SETTLE_TIMEOUT_MS + DESCRIPTION_FILL_VISIBLE_DEADLINE_MS,
        "detail budget must be at least the list guard's timeout plus the visible fill deadline",
    );
});

test("DETAIL_SETTLE_TIMEOUT_MS is strictly larger than the plain list-search guard", () => {
    assert.ok(DETAIL_SETTLE_TIMEOUT_MS > ACTION_SETTLE_TIMEOUT_MS);
});
