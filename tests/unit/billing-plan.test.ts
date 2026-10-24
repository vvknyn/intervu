import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENDS_SOON_MS, planSummary } from "../../src/lib/billing/plan";
import { DAY_MS, MONTH_MS, accessEvents, computeAccessUntil } from "../../src/lib/billing/recompute";
import type { Grant } from "../../src/lib/billing/profile-store";

const NOW = Date.UTC(2026, 9, 24);
const gift = (id: string, at: number, days = 30): Grant => ({ id, at, days });
/** The stored end the recompute would write for these facts. */
const stored = (payments: { createdMs: number; months: number }[], grants: Grant[]) => computeAccessUntil(accessEvents(payments, grants));

describe("planSummary", () => {
    it("never paid: free", () => {
        assert.deepEqual(planSummary({ accessUntil: 0, grants: [], now: NOW }), { status: "free" });
    });
    it("expired (including exactly now): free", () => {
        const g = [gift("a", NOW - 40 * DAY_MS)];
        assert.deepEqual(planSummary({ accessUntil: stored([], g), grants: g, now: NOW }), { status: "free" });
        assert.deepEqual(planSummary({ accessUntil: NOW, grants: [], now: NOW }), { status: "free" });
    });
    it("paid only: full, not a gift", () => {
        const p = [{ createdMs: NOW - DAY_MS, months: 3 }];
        assert.deepEqual(planSummary({ accessUntil: stored(p, []), grants: [], now: NOW }), {
            status: "full", until: NOW - DAY_MS + 3 * MONTH_MS, gift: false, endsSoon: false,
        });
    });
    it("gift only: a gift", () => {
        const g = [gift("a", NOW - 10 * DAY_MS)];
        const s = planSummary({ accessUntil: stored([], g), grants: g, now: NOW });
        assert.equal(s.status === "full" && s.gift, true);
    });
    it("paid plus gift: the payment moved the end past the gift-only fold, so not a gift", () => {
        const g = [gift("a", NOW - 10 * DAY_MS)];
        const p = [{ createdMs: NOW - 5 * DAY_MS, months: 1 }];
        const s = planSummary({ accessUntil: stored(p, g), grants: g, now: NOW });
        assert.equal(s.status === "full" && s.gift, false);
    });
    it("two stacked gifts: still a gift, ending after both", () => {
        const g = [gift("a", NOW - 10 * DAY_MS), gift("b", NOW - 5 * DAY_MS)];
        const s = planSummary({ accessUntil: stored([], g), grants: g, now: NOW });
        assert.deepEqual(s, { status: "full", until: NOW - 10 * DAY_MS + 60 * DAY_MS, gift: true, endsSoon: false });
    });
    it("endsSoon at exactly 7 days, not at 7 days and 1 ms", () => {
        const at = (ms: number) => planSummary({ accessUntil: NOW + ms, grants: [], now: NOW });
        assert.equal((at(ENDS_SOON_MS) as { endsSoon: boolean }).endsSoon, true);
        assert.equal((at(ENDS_SOON_MS + 1) as { endsSoon: boolean }).endsSoon, false);
    });
});
