import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENDS_SOON_MS, planSummary } from "../../src/lib/billing/plan";
import { RENEWAL_GRACE_MS, paidSummary } from "../../src/lib/billing/access";
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
            status: "full", until: NOW - DAY_MS + 3 * MONTH_MS, gift: false, endsSoon: false, autoRenew: false,
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
        assert.deepEqual(s, { status: "full", until: NOW - 10 * DAY_MS + 60 * DAY_MS, gift: true, endsSoon: false, autoRenew: false });
    });
    it("endsSoon at exactly 7 days, not at 7 days and 1 ms", () => {
        const at = (ms: number) => planSummary({ accessUntil: NOW + ms, grants: [], now: NOW });
        assert.equal((at(ENDS_SOON_MS) as { endsSoon: boolean }).endsSoon, true);
        assert.equal((at(ENDS_SOON_MS + 1) as { endsSoon: boolean }).endsSoon, false);
    });
});

describe("planSummary when month to month is live", () => {
    // The stored end carries RENEWAL_GRACE_MS of slack; the plan shows the next payment date and never "ending".
    it("shows the next payment date, not the stored end, and is never ending or a gift", () => {
        const nextCharge = NOW + 2 * DAY_MS;
        const s = planSummary({ accessUntil: nextCharge + RENEWAL_GRACE_MS, grants: [], now: NOW, autoRenew: true });
        assert.deepEqual(s, { status: "full", until: nextCharge, gift: false, endsSoon: false, autoRenew: true });
    });
    it("a gift alone is still a gift when month to month is off", () => {
        const g = [gift("a", NOW - 10 * DAY_MS)];
        const s = planSummary({ accessUntil: stored([], g), grants: g, now: NOW, autoRenew: false });
        assert.equal(s.status === "full" && s.gift, true);
    });
    it("the slack keeps the account paid while the next charge settles, then free once it is gone", () => {
        const end = NOW - 1000;
        assert.equal(planSummary({ accessUntil: end + RENEWAL_GRACE_MS, grants: [], now: NOW, autoRenew: true }).status, "full");
        assert.equal(planSummary({ accessUntil: end, grants: [], now: NOW, autoRenew: false }).status, "free");
    });
});

describe("paidSummary (what /pricing shows)", () => {
    it("the stored end for a prepaid or gifted account, the next payment for month to month", () => {
        assert.deepEqual(paidSummary({ access_until: NOW + DAY_MS }, NOW), { paidUntil: NOW + DAY_MS, autoRenewing: false });
        assert.deepEqual(paidSummary({ access_until: NOW + 5 * DAY_MS, auto_renew: true }, NOW), { paidUntil: NOW + 5 * DAY_MS - RENEWAL_GRACE_MS, autoRenewing: true });
    });
    it("no date once lapsed, or while only the renewal slack is left, but month to month still shows as on", () => {
        assert.deepEqual(paidSummary({ access_until: NOW - 1 }, NOW), { paidUntil: null, autoRenewing: false });
        assert.deepEqual(paidSummary({ access_until: NOW + DAY_MS, auto_renew: true }, NOW), { paidUntil: null, autoRenewing: true });
        assert.deepEqual(paidSummary(undefined, NOW), { paidUntil: null, autoRenewing: false });
    });
});
