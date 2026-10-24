import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { accessUntil, hasPaidAccess } from "../../src/lib/billing/access";
import { useBillingDb } from "../../src/lib/billing/profile-store";
import {
    DAY_MS,
    MONTH_MS,
    accessEvents,
    computeAccessUntil,
    monthsFromSession,
    readPaymentFacts,
    recomputeAccess,
    type SessionFacts,
} from "../../src/lib/billing/recompute";
import { memoryFirestore } from "./memory-firestore";

const T0 = Date.UTC(2026, 9, 1);
const paid = (over: Partial<SessionFacts> = {}): SessionFacts => ({
    mode: "payment", status: "complete", paymentStatus: "paid", pricedQuantity: 3, charged: 3600, refunded: 0, disputeLost: false, ...over,
});

describe("computeAccessUntil (payments and grants, one date-ordered pass)", () => {
    const buy = { at: T0, durationMs: MONTH_MS };
    const buy2 = { at: T0 + 5 * DAY_MS, durationMs: 2 * MONTH_MS };
    it("is the same for any order and for a replay", () => {
        const once = computeAccessUntil([buy, buy2]);
        assert.equal(once, computeAccessUntil([buy2, buy]));
        assert.equal(once, computeAccessUntil([buy, buy2]));
        assert.equal(once, T0 + 3 * MONTH_MS);
        assert.equal(computeAccessUntil([]), 0);
    });
    it("stacks on live access and restarts at the event date after a lapse", () => {
        assert.equal(computeAccessUntil([{ at: T0, durationMs: 10 * DAY_MS }, buy]), T0 + 10 * DAY_MS + MONTH_MS);
        assert.equal(computeAccessUntil([buy, { at: T0 + 400 * DAY_MS, durationMs: MONTH_MS }]), T0 + 400 * DAY_MS + MONTH_MS);
    });
    it("F1: a grant issued after a purchase lapsed adds only its own days, never re-credits the purchase", () => {
        const twelve = { createdMs: T0, months: 12 };
        const lateGrant = { id: "g", at: T0 + 500 * DAY_MS, days: 1 };
        assert.equal(computeAccessUntil(accessEvents([twelve], [lateGrant])), lateGrant.at + DAY_MS);
        // and a purchase after a lapsed grant starts at the purchase date
        assert.equal(computeAccessUntil(accessEvents([{ createdMs: T0 + 100 * DAY_MS, months: 1 }], [{ id: "g", at: T0, days: 30 }])), T0 + 100 * DAY_MS + MONTH_MS);
    });
    it("a grant made while a purchase is live stacks on it", () => {
        assert.equal(computeAccessUntil(accessEvents([{ createdMs: T0, months: 1 }], [{ id: "g", at: T0 + 10 * DAY_MS, days: 30 }])), T0 + 2 * MONTH_MS);
    });
    it("a month is 30 days", () => assert.equal(MONTH_MS, 30 * DAY_MS));
});

describe("monthsFromSession", () => {
    it("counts a settled payment in full", () => assert.equal(monthsFromSession(paid()), 3));
    it("a full refund removes every month; a partial refund keeps the whole months left", () => {
        assert.equal(monthsFromSession(paid({ refunded: 3600 })), 0);
        assert.equal(monthsFromSession(paid({ refunded: 1200 })), 2);
        assert.equal(monthsFromSession(paid({ pricedQuantity: 1, charged: 1200, refunded: 1200 })), 0);
    });
    it("excludes unpaid, open and non-payment sessions", () => {
        assert.equal(monthsFromSession(paid({ paymentStatus: "unpaid" })), 0);
        assert.equal(monthsFromSession(paid({ status: "open" })), 0);
        assert.equal(monthsFromSession(paid({ mode: "subscription" })), 0);
    });
    it("F8: a lost dispute counts as fully refunded, whatever the quantity", () => {
        assert.equal(monthsFromSession(paid({ disputeLost: true })), 0);
        assert.equal(monthsFromSession(paid({ disputeLost: true, pricedQuantity: 12 })), 0);
    });
    it("without a charge, the priced quantity stands", () => assert.equal(monthsFromSession(paid({ charged: null })), 3));
});

describe("access reads", () => {
    it("accessUntil is the stored access_until, 0 for nothing or junk", () => {
        assert.equal(accessUntil({ access_until: 9 }), 9);
        assert.equal(accessUntil({ access_until: "x" }), 0);
        assert.equal(accessUntil({}), 0);
        assert.equal(accessUntil(null), 0);
    });
    it("hasPaidAccess is strictly after now: the expiry instant is no longer paid", async () => {
        const { db } = memoryFirestore({ "profiles/u": { access_until: 1000 } });
        useBillingDb(db);
        assert.equal(await hasPaidAccess("u", 999), true);
        assert.equal(await hasPaidAccess("u", 1000), false);
        assert.equal(await hasPaidAccess("nobody", 1), false);
        useBillingDb();
    });
});

/** A Stripe fake that ASSERTS the parameters the recompute sends. */
function fakeStripe(over: { sessions: Stripe.Checkout.Session[]; lineItems: Record<string, { product: string; quantity: number }[]>; productOfPrice?: string; disputes?: Record<string, string[]> }) {
    const seen = { list: [] as Stripe.Checkout.SessionListParams[], lineItems: [] as string[], prices: [] as string[], disputes: [] as string[] };
    const stripe = {
        prices: { retrieve: async (id: string) => (seen.prices.push(id), { id, product: over.productOfPrice ?? "prod_velai" }) },
        disputes: {
            list: async (p: { charge: string }) => (seen.disputes.push(p.charge), { data: (over.disputes?.[p.charge] ?? []).map((status) => ({ status })) }),
        },
        checkout: {
            sessions: {
                list: (params: Stripe.Checkout.SessionListParams) => {
                    seen.list.push(params);
                    return (async function* () { yield* over.sessions; })();
                },
                listLineItems: async (id: string) => {
                    seen.lineItems.push(id);
                    return { data: (over.lineItems[id] ?? []).map((li) => ({ price: { product: li.product }, quantity: li.quantity })) };
                },
            },
        },
    } as unknown as Stripe;
    return { stripe, seen };
}
const session = (id: string, created: number, over: Record<string, unknown> = {}) =>
    ({
        id, created, mode: "payment", status: "complete", payment_status: "paid", amount_total: 1200,
        payment_intent: { latest_charge: { id: `ch_${id}`, amount: 1200, amount_refunded: 0, disputed: false } },
        ...over,
    }) as unknown as Stripe.Checkout.Session;

describe("readPaymentFacts", () => {
    it("lists the customer's complete sessions, reads each one's line items by session id, and keeps only the Velai product", async () => {
        const { stripe, seen } = fakeStripe({
            sessions: [
                session("a", 100),
                session("b", 200, { payment_status: "unpaid" }),
                session("c", 300),
                session("d", 400, { payment_intent: { latest_charge: { id: "ch_d", amount: 1200, amount_refunded: 1200, disputed: false } } }),
            ],
            lineItems: { a: [{ product: "prod_velai", quantity: 2 }], b: [{ product: "prod_velai", quantity: 1 }], c: [{ product: "prod_other", quantity: 1 }], d: [{ product: "prod_velai", quantity: 1 }] },
        });
        assert.deepEqual(await readPaymentFacts(stripe, "cus_1", "prod_velai"), [{ createdMs: 100_000, months: 2 }]);
        assert.equal(seen.list.length, 1);
        assert.equal(seen.list[0].customer, "cus_1");
        assert.equal(seen.list[0].status, "complete");
        assert.ok(seen.list[0].expand?.includes("data.payment_intent.latest_charge"));
        assert.ok(!seen.list[0].expand?.some((e) => e.includes("line_items")), "line items are not expanded on list");
        assert.deepEqual(seen.lineItems, ["a", "b", "c", "d"]);
    });
    it("F8: a lost dispute removes the session's months; a won one does not", async () => {
        const disputed = (id: string) => session(id, 100, { payment_intent: { latest_charge: { id: `ch_${id}`, amount: 1200, amount_refunded: 0, disputed: true } } });
        const { stripe, seen } = fakeStripe({
            sessions: [disputed("lost"), disputed("won")],
            lineItems: { lost: [{ product: "prod_velai", quantity: 1 }], won: [{ product: "prod_velai", quantity: 1 }] },
            disputes: { ch_lost: ["lost"], ch_won: ["won"] },
        });
        assert.deepEqual(await readPaymentFacts(stripe, "cus_1", "prod_velai"), [{ createdMs: 100_000, months: 1 }]);
        assert.deepEqual(seen.disputes, ["ch_lost", "ch_won"]);
    });
});

describe("recomputeAccess", () => {
    beforeEach(() => {
        process.env.STRIPE_PRICE_ID = "price_new";
    });
    it("F7: counts purchases made at an older price of the same product", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const { stripe, seen } = fakeStripe({ sessions: [session("a", T0 / 1000)], lineItems: { a: [{ product: "prod_velai", quantity: 2 }] } });
        const until = await recomputeAccess("u", null, stripe);
        assert.deepEqual(seen.prices, ["price_new"]);
        assert.equal(until, T0 + 2 * MONTH_MS);
        assert.equal(docs.get("profiles/u")?.access_until, until);
        useBillingDb();
    });
    it("F7: a different product does not count", async () => {
        const { db } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const { stripe } = fakeStripe({ sessions: [session("a", T0 / 1000)], lineItems: { a: [{ product: "prod_velai", quantity: 2 }] }, productOfPrice: "prod_else" });
        assert.equal(await recomputeAccess("u", null, stripe), 0);
        useBillingDb();
    });
    it("with no customer it makes no Stripe call and folds grants alone", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { grants: [{ id: "g", at: T0, days: 30 }] } });
        useBillingDb(db);
        assert.equal(await recomputeAccess("u", null, null), T0 + 30 * DAY_MS);
        assert.equal(docs.get("profiles/u")?.stripe_customer_id, undefined);
        useBillingDb();
    });
    it("stores a webhook's customer only when the profile has none, and uses the stored one otherwise", async () => {
        const { db, docs } = memoryFirestore({ "profiles/new": {}, "profiles/old": { stripe_customer_id: "cus_old" } });
        useBillingDb(db);
        const { stripe, seen } = fakeStripe({ sessions: [], lineItems: {} });
        await recomputeAccess("new", "cus_hint", stripe);
        await recomputeAccess("old", "cus_hint", stripe);
        assert.equal(docs.get("profiles/new")?.stripe_customer_id, "cus_hint");
        assert.equal(docs.get("profiles/old")?.stripe_customer_id, "cus_old");
        assert.deepEqual(seen.list.map((p) => p.customer), ["cus_hint", "cus_old"]);
        useBillingDb();
    });
    it("fails loudly when a customer exists but Stripe is not configured", async () => {
        const { db } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        await assert.rejects(() => recomputeAccess("u", null, null), /not configured/);
        useBillingDb();
    });
});
