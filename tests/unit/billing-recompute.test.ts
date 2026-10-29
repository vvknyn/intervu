import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { accessUntil, hasPaidAccess } from "../../src/lib/billing/access";
import { useBillingDb } from "../../src/lib/billing/profile-store";
import { MONTH_PRICE_USD } from "../../src/app/pricing/offer";
import { RENEWAL_GRACE_MS } from "../../src/lib/billing/access";
import {
    DAY_MS,
    MONTH_MS,
    accessEvents,
    computeAccessUntil,
    monthsFromSession,
    readPaidInvoices,
    readPaymentFacts,
    readPaymentRecords,
    readSubscriptionSummary,
    recomputeAccess,
    renewalsFromInvoice,
    type PaidInvoice,
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
    it("F6: nothing actually charged (zero or unknown) credits no months, refunds or not", () => {
        assert.equal(monthsFromSession(paid({ charged: 0 })), 0);
        assert.equal(monthsFromSession(paid({ charged: null })), 0);
        assert.equal(monthsFromSession(paid({ charged: 0, refunded: 0, pricedQuantity: 12 })), 0);
    });
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
function fakeStripe(over: {
    sessions: Stripe.Checkout.Session[];
    lineItems: Record<string, { product: string; quantity: number; unit_amount?: number }[]>;
    productOfPrice?: string;
    disputes?: Record<string, string[]>;
    invoices?: unknown[];
    charges?: unknown[];
    subscriptions?: unknown[];
}) {
    const seen = { list: [] as Stripe.Checkout.SessionListParams[], lineItems: [] as string[], prices: [] as string[], disputes: [] as string[], invoices: [] as Stripe.InvoiceListParams[] };
    const stream = <T,>(items: readonly T[] = []) => (async function* () { yield* items; })();
    const stripe = {
        prices: { retrieve: async (id: string) => (seen.prices.push(id), { id, product: over.productOfPrice ?? "prod_velai" }) },
        charges: { list: () => stream(over.charges) },
        invoices: { list: (params: Stripe.InvoiceListParams) => (seen.invoices.push(params), stream(over.invoices)) },
        subscriptions: { list: () => stream(over.subscriptions) },
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
                    return { data: (over.lineItems[id] ?? []).map((li) => ({ price: { product: li.product, unit_amount: li.unit_amount ?? MONTH_PRICE_USD * 100, currency: "usd" }, quantity: li.quantity })) };
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

describe("F5: months count by product, not by the price paid", () => {
    it("a paid session at a different unit_amount on the same product still counts its months", async () => {
        const { stripe } = fakeStripe({
            sessions: [session("old", 200)],
            lineItems: { old: [{ product: "prod_velai", quantity: 2, unit_amount: MONTH_PRICE_USD * 100 * 2 }] },
        });
        assert.deepEqual(await readPaymentFacts(stripe, "cus_1", "prod_velai"), [{ createdMs: 200_000, months: 2 }]);
    });
    it("a line item on another product counts 0", async () => {
        const { stripe } = fakeStripe({
            sessions: [session("other", 100)],
            lineItems: { other: [{ product: "prod_other", quantity: 2 }] },
        });
        assert.deepEqual(await readPaymentFacts(stripe, "cus_1", "prod_velai"), []);
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
    it("F7: a uid with no profile (erased) gets no billing record and nothing is logged about it", async () => {
        const { db, docs } = memoryFirestore({});
        useBillingDb(db);
        const logged: string[] = [];
        const warn = console.warn;
        console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
        try {
            const { stripe, seen } = fakeStripe({ sessions: [session("a", T0 / 1000)], lineItems: { a: [{ product: "prod_velai", quantity: 1 }] } });
            assert.equal(await recomputeAccess("erased-uid", "cus_1", stripe), 0);
            assert.equal(docs.size, 0);
            assert.equal(seen.list.length, 0);
            assert.equal(logged.length, 1);
            assert.ok(!logged[0].includes("erased-uid"));
        } finally {
            console.warn = warn;
            useBillingDb();
        }
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

/** A paid subscription invoice for `periods` (each [startMs, endMs]) on `product`, paid by payment intent `pi`. */
const invoice = (id: string, periods: [number, number][], over: Record<string, unknown> = {}, product = "prod_velai") =>
    ({
        id, created: periods[0][0] / 1000, currency: "usd", amount_paid: 600, status: "paid",
        status_transitions: { paid_at: periods[0][0] / 1000 + 3600 },
        hosted_invoice_url: `https://invoice.stripe.com/${id}`,
        payments: { data: [{ payment: { type: "payment_intent", payment_intent: `pi_${id}` } }] },
        lines: {
            data: periods.map(([start, end]) => ({
                period: { start: start / 1000, end: end / 1000 },
                parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
                pricing: { price_details: { product } },
            })),
        },
        ...over,
    }) as unknown as Stripe.Invoice;
const charge = (id: string, over: Record<string, unknown> = {}) =>
    ({ id: `ch_${id}`, payment_intent: `pi_${id}`, status: "succeeded", amount: 600, amount_refunded: 0, currency: "usd", disputed: false, receipt_url: `https://pay.stripe.com/receipts/${id}`, ...over }) as unknown as Stripe.Charge;
const sub = (status: string, over: Record<string, unknown> = {}, product = "prod_velai", periodEnd = 1_000) =>
    ({ status, cancel_at_period_end: false, cancel_at: null, items: { data: [{ price: { product }, current_period_end: periodEnd }] }, ...over }) as unknown as Stripe.Subscription;

describe("renewalsFromInvoice", () => {
    const inv = (amount: number, refunded: number, periods = [{ startMs: T0, endMs: T0 + 31 * DAY_MS }]): PaidInvoice => ({
        periods,
        record: { kind: "monthly", paidMs: T0, amount, refunded, currency: "usd", months: null, receiptUrl: null },
    });
    it("buys the billed period in full, from the period's own start", () => {
        assert.deepEqual(renewalsFromInvoice(inv(600, 0)), [{ startMs: T0, durationMs: 31 * DAY_MS }]);
    });
    it("a partial refund keeps its share of the period; a full refund keeps none", () => {
        assert.deepEqual(renewalsFromInvoice(inv(600, 300)), [{ startMs: T0, durationMs: Math.floor((31 * DAY_MS) / 2) }]);
        assert.deepEqual(renewalsFromInvoice(inv(600, 600)), []);
    });
    it("nothing charged (a free invoice) buys nothing", () => {
        assert.deepEqual(renewalsFromInvoice(inv(0, 0)), []);
    });
});

describe("readPaidInvoices", () => {
    it("lists paid invoices with their payments expanded, keeps subscription lines on the Velai product, and ties each to its charge", async () => {
        const { stripe, seen } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [
                invoice("a", [[T0, T0 + 31 * DAY_MS]]),
                invoice("other", [[T0, T0 + 31 * DAY_MS]], {}, "prod_other"),
                invoice("prorated", [[T0, T0 + DAY_MS]], { lines: { data: [{ period: { start: 0, end: 1 }, parent: { type: "subscription_item_details", subscription_item_details: { proration: true } }, pricing: { price_details: { product: "prod_velai" } } }] } }),
                invoice("oneoff", [[T0, T0 + DAY_MS]], { lines: { data: [{ period: { start: 0, end: 1 }, parent: { type: "invoice_item_details" }, pricing: { price_details: { product: "prod_velai" } } }] } }),
            ],
            charges: [charge("a")],
        });
        const got = await readPaidInvoices(stripe, "cus_1", "prod_velai");
        assert.equal(got.length, 1);
        assert.deepEqual(got[0].periods, [{ startMs: T0, endMs: T0 + 31 * DAY_MS }]);
        assert.deepEqual(got[0].record, {
            kind: "monthly", paidMs: T0 + 3_600_000, amount: 600, refunded: 0, currency: "usd", months: null, receiptUrl: "https://pay.stripe.com/receipts/a",
        });
        assert.equal(seen.invoices[0].customer, "cus_1");
        assert.equal(seen.invoices[0].status, "paid");
        assert.ok(seen.invoices[0].expand?.includes("data.payments"));
    });
    it("a refunded charge shrinks the record; a lost dispute removes all of it; a charge that never succeeded is not matched", async () => {
        const { stripe } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [invoice("r", [[T0, T0 + 30 * DAY_MS]]), invoice("d", [[T0, T0 + 30 * DAY_MS]]), invoice("f", [[T0, T0 + 30 * DAY_MS]])],
            charges: [charge("r", { amount_refunded: 200 }), charge("d", { disputed: true }), charge("f", { status: "failed" })],
            disputes: { ch_d: ["lost"] },
        });
        const [r, d, f] = await readPaidInvoices(stripe, "cus_1", "prod_velai");
        assert.equal(r.record.refunded, 200);
        assert.equal(d.record.refunded, 600);
        assert.deepEqual(renewalsFromInvoice(d), []);
        // No matched charge: the invoice's own amount, no refund known, the hosted invoice as the receipt.
        assert.equal(f.record.refunded, 0);
        assert.equal(f.record.receiptUrl, "https://invoice.stripe.com/f");
    });
});

describe("readSubscriptionSummary", () => {
    const summary = async (subscriptions: Stripe.Subscription[]) => readSubscriptionSummary(fakeStripe({ sessions: [], lineItems: {}, subscriptions }).stripe, "cus_1", "prod_velai");
    it("renewing: active and not scheduled to end, with its period end", async () => {
        assert.deepEqual(await summary([sub("active")]), { state: "renewing", periodEndMs: 1_000_000 });
    });
    it("ending: cancelled at period end, or on a date, runs to that point", async () => {
        assert.deepEqual(await summary([sub("active", { cancel_at_period_end: true })]), { state: "ending", periodEndMs: 1_000_000 });
        assert.deepEqual(await summary([sub("active", { cancel_at: 500 })]), { state: "ending", periodEndMs: 500_000 });
    });
    it("past due or unpaid: the last charge failed", async () => {
        assert.equal((await summary([sub("past_due")]))?.state, "past_due");
        assert.equal((await summary([sub("unpaid")]))?.state, "past_due");
    });
    it("a cancelled or incomplete subscription, or one on another product, is nothing", async () => {
        assert.equal(await summary([sub("canceled"), sub("incomplete"), sub("active", {}, "prod_other")]), null);
        assert.equal(await summary([]), null);
    });
    it("renewing wins over past due, which wins over ending", async () => {
        assert.equal((await summary([sub("active", { cancel_at_period_end: true }), sub("past_due"), sub("active")]))?.state, "renewing");
        assert.equal((await summary([sub("active", { cancel_at_period_end: true }), sub("past_due")]))?.state, "past_due");
    });
});

describe("readPaymentRecords", () => {
    it("lists prepaid sessions and monthly invoices together, newest first, a refunded one still shown", async () => {
        const { stripe } = fakeStripe({
            sessions: [
                session("a", 100, { amount_total: 1800, payment_intent: { latest_charge: { id: "ch_a", amount: 1800, amount_refunded: 0, currency: "usd", receipt_url: "https://pay.stripe.com/receipts/a", disputed: false } } }),
                session("b", 50, { payment_intent: { latest_charge: { id: "ch_b", amount: 1200, amount_refunded: 1200, currency: "usd", disputed: false } } }),
                session("unpaid", 80, { payment_status: "unpaid" }),
                session("other", 90),
            ],
            lineItems: { a: [{ product: "prod_velai", quantity: 3 }], b: [{ product: "prod_velai", quantity: 2 }], unpaid: [{ product: "prod_velai", quantity: 1 }], other: [{ product: "prod_other", quantity: 1 }] },
            invoices: [invoice("m", [[T0, T0 + 31 * DAY_MS]])],
            charges: [charge("m")],
        });
        const rows = await readPaymentRecords(stripe, "cus_1", "prod_velai");
        assert.deepEqual(rows.map((r) => [r.kind, r.paidMs, r.amount, r.refunded, r.months]), [
            ["monthly", T0 + 3_600_000, 600, 0, null],
            ["prepaid", 100_000, 1800, 0, 3],
            ["prepaid", 50_000, 1200, 1200, 0],
        ]);
        assert.equal(rows[1].receiptUrl, "https://pay.stripe.com/receipts/a");
    });
    it("only an https receipt link is passed on", async () => {
        const { stripe } = fakeStripe({
            sessions: [session("a", 100, { payment_intent: { latest_charge: { id: "ch_a", amount: 1200, amount_refunded: 0, currency: "usd", receipt_url: "javascript:alert(1)", disputed: false } } })],
            lineItems: { a: [{ product: "prod_velai", quantity: 1 }] },
        });
        assert.equal((await readPaymentRecords(stripe, "cus_1", "prod_velai"))[0].receiptUrl, null);
    });
});

describe("recomputeAccess with month to month", () => {
    beforeEach(() => {
        process.env.STRIPE_PRICE_ID = "price_new";
    });
    it("back-to-back renewals leave no gap, however long each month is, and a live subscription carries the renewal slack", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const p1: [number, number] = [T0, T0 + 31 * DAY_MS];
        const p2: [number, number] = [T0 + 31 * DAY_MS, T0 + 59 * DAY_MS];
        const { stripe } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [invoice("1", [p1]), invoice("2", [p2])],
            charges: [charge("1"), charge("2")],
            subscriptions: [sub("active")],
        });
        const until = await recomputeAccess("u", null, stripe);
        assert.equal(until, T0 + 59 * DAY_MS + RENEWAL_GRACE_MS);
        assert.equal(docs.get("profiles/u")?.access_until, until);
        assert.equal(docs.get("profiles/u")?.auto_renew, true);
        useBillingDb();
    });
    it("a cancelled subscription keeps the paid period and nothing more; auto_renew goes false", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1", auto_renew: true } });
        useBillingDb(db);
        const { stripe } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [invoice("1", [[T0, T0 + 31 * DAY_MS]])],
            charges: [charge("1")],
            subscriptions: [sub("active", { cancel_at_period_end: true })],
        });
        assert.equal(await recomputeAccess("u", null, stripe), T0 + 31 * DAY_MS);
        assert.equal(docs.get("profiles/u")?.auto_renew, false);
        useBillingDb();
    });
    it("a failed renewal (past due) drops the slack at once", async () => {
        const { db, docs } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const { stripe } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [invoice("1", [[T0, T0 + 31 * DAY_MS]])],
            charges: [charge("1")],
            subscriptions: [sub("past_due")],
        });
        assert.equal(await recomputeAccess("u", null, stripe), T0 + 31 * DAY_MS);
        assert.equal(docs.get("profiles/u")?.auto_renew, false);
        useBillingDb();
    });
    it("a refunded first payment ends the access it bought", async () => {
        const { db } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const { stripe } = fakeStripe({
            sessions: [], lineItems: {},
            invoices: [invoice("1", [[T0, T0 + 31 * DAY_MS]])],
            charges: [charge("1", { amount_refunded: 600 })],
            subscriptions: [sub("canceled")],
        });
        assert.equal(await recomputeAccess("u", null, stripe), 0);
        useBillingDb();
    });
    it("prepaid months and a subscription stack: neither is lost", async () => {
        const { db } = memoryFirestore({ "profiles/u": { stripe_customer_id: "cus_1" } });
        useBillingDb(db);
        const { stripe } = fakeStripe({
            sessions: [session("a", T0 / 1000)],
            lineItems: { a: [{ product: "prod_velai", quantity: 1 }] },
            invoices: [invoice("1", [[T0 + 5 * DAY_MS, T0 + 36 * DAY_MS]])],
            charges: [charge("1")],
        });
        assert.equal(await recomputeAccess("u", null, stripe), T0 + MONTH_MS + 31 * DAY_MS);
        useBillingDb();
    });
});
