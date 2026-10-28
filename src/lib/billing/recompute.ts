/**
 * access_until is RECOMPUTED from Stripe's own record of the customer's paid
 * Checkout Sessions (prepaid months) and paid subscription invoices (month to
 * month), never incremented: a replayed or reordered event cannot change the
 * answer, and a refund is just another fact the next read sees.
 */
import type Stripe from "stripe";
import { readPriceId } from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe-client";
import { readIdField } from "@/lib/billing/events";
import { RENEWAL_GRACE_MS } from "@/lib/billing/access";
import { readProfile, shapeProfileBilling, writeAccessUntil, type Grant } from "@/lib/billing/profile-store";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * DAY_MS;

/** Something that adds time at a date: a paid purchase (months) or a grant (days). */
export interface AccessEvent {
    at: number;
    durationMs: number;
}

/** Pure. One date-ordered pass: time stacks on live access and restarts at the event date after a lapse. */
export function computeAccessUntil(events: readonly AccessEvent[]): number {
    let cursor = 0;
    for (const e of [...events].sort((a, b) => a.at - b.at)) cursor = Math.max(cursor, e.at) + e.durationMs;
    return cursor;
}

export interface PaymentFact {
    createdMs: number;
    months: number;
}

/** A service period a month-to-month payment bought: from its own start, for the time still standing after refunds. */
export interface RenewalFact {
    startMs: number;
    durationMs: number;
}

export const accessEvents = (
    payments: readonly PaymentFact[],
    grants: readonly Grant[],
    renewals: readonly RenewalFact[] = [],
): AccessEvent[] => [
    ...payments.map((p) => ({ at: p.createdMs, durationMs: p.months * MONTH_MS })),
    ...renewals.map((r) => ({ at: r.startMs, durationMs: r.durationMs })),
    ...grants.map((g) => ({ at: g.at, durationMs: g.days * DAY_MS })),
];

export interface SessionFacts {
    mode: string;
    status: string | null;
    paymentStatus: string;
    /** Quantity of every line item on the Velai product, at whatever price it was sold. */
    pricedQuantity: number;
    /** What was actually charged (null = unknown) and refunded. */
    charged: number | null;
    refunded: number;
    /** The buyer won a dispute against the charge: it counts as fully refunded. */
    disputeLost: boolean;
}

/** Pure. Whole prepaid months still standing after refunds; 0 for anything not a settled payment. */
export function monthsFromSession(s: SessionFacts): number {
    if (s.mode !== "payment" || s.status !== "complete" || s.paymentStatus !== "paid") return 0;
    if (s.disputeLost) return 0;
    if (s.charged === null || s.charged <= 0) return 0;
    return Math.max(0, Math.floor((s.pricedQuantity * (s.charged - s.refunded)) / s.charged));
}

/** The buyer won a dispute against the charge: it counts as fully refunded. */
async function disputeLostOn(stripe: Stripe, charge: Stripe.Charge | null): Promise<boolean> {
    return charge?.disputed
        ? (await stripe.disputes.list({ charge: charge.id, limit: 100 })).data.some((d) => d.status === "lost")
        : false;
}

const receiptOf = (charge: Stripe.Charge | null): string | null =>
    typeof charge?.receipt_url === "string" && charge.receipt_url.startsWith("https://") ? charge.receipt_url : null;

async function sessionFacts(
    stripe: Stripe,
    session: Stripe.Checkout.Session,
    productId: string,
): Promise<{ facts: SessionFacts; charge: Stripe.Charge | null }> {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    const pricedQuantity = items.data
        .filter((li) => readIdField(li.price?.product) === productId)
        .reduce((sum, li) => sum + (li.quantity ?? 0), 0);
    const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const disputeLost = await disputeLostOn(stripe, charge);
    return {
        facts: {
            mode: session.mode,
            status: session.status,
            paymentStatus: session.payment_status,
            pricedQuantity,
            charged: charge ? charge.amount : session.amount_total,
            refunded: charge ? charge.amount_refunded : 0,
            disputeLost,
        },
        charge,
    };
}

/** What the payments list shows for one money movement; amounts are in the currency's minor unit. */
export interface PaymentRecord {
    kind: "prepaid" | "monthly";
    paidMs: number;
    amount: number;
    refunded: number;
    currency: string;
    /** Prepaid: whole months bought (0 once fully refunded). Monthly: null. */
    months: number | null;
    receiptUrl: string | null;
}

interface PaidSession {
    fact: PaymentFact | null;
    record: PaymentRecord | null;
}

/** Every payment-mode session the customer completed: its months (null when none stand) and, if it sold the Velai product, its list row. */
async function readPaidSessions(stripe: Stripe, customerId: string, productId: string): Promise<PaidSession[]> {
    const out: PaidSession[] = [];
    const sessions = stripe.checkout.sessions.list({
        customer: customerId,
        status: "complete",
        limit: 100,
        expand: ["data.payment_intent.latest_charge"],
    });
    for await (const session of sessions) {
        const { facts, charge } = await sessionFacts(stripe, session, productId);
        const months = monthsFromSession(facts);
        const createdMs = session.created * 1000;
        const sold = facts.mode === "payment" && facts.paymentStatus === "paid" && facts.pricedQuantity > 0 && (facts.charged ?? 0) > 0;
        const amount = facts.charged ?? 0;
        out.push({
            fact: months > 0 ? { createdMs, months } : null,
            record: sold
                ? {
                      kind: "prepaid",
                      paidMs: createdMs,
                      amount,
                      refunded: facts.disputeLost ? amount : Math.min(amount, facts.refunded),
                      currency: charge?.currency ?? session.currency ?? "usd",
                      months,
                      receiptUrl: receiptOf(charge),
                  }
                : null,
        });
    }
    return out;
}

/** Thin Stripe reader: every payment-mode session the customer completed, as dated month counts. */
export async function readPaymentFacts(stripe: Stripe, customerId: string, productId: string): Promise<PaymentFact[]> {
    return (await readPaidSessions(stripe, customerId, productId)).flatMap((p) => (p.fact ? [p.fact] : []));
}

/** One paid subscription invoice: the periods it billed on the Velai product, and what was charged and refunded for it. */
export interface PaidInvoice {
    periods: { startMs: number; endMs: number }[];
    record: PaymentRecord;
}

/** Pure. The time a paid invoice still buys: each billed period, cut by the share of the charge refunded (all of it after a lost dispute). */
export function renewalsFromInvoice(inv: PaidInvoice): RenewalFact[] {
    const { amount, refunded } = inv.record;
    if (amount <= 0) return [];
    const standing = Math.max(0, amount - refunded) / amount;
    return inv.periods.flatMap((p) => {
        const durationMs = Math.floor((p.endMs - p.startMs) * standing);
        return durationMs > 0 ? [{ startMs: p.startMs, durationMs }] : [];
    });
}

/**
 * Every paid subscription invoice with a line on the Velai product. A subscription's payment is an
 * invoice, not a Checkout payment: its charge is found through the invoice's payments, then one
 * charge listing gives the refunds, disputes and receipt.
 */
export async function readPaidInvoices(stripe: Stripe, customerId: string, productId: string): Promise<PaidInvoice[]> {
    const chargeByIntent = new Map<string, Stripe.Charge>();
    for await (const charge of stripe.charges.list({ customer: customerId, limit: 100 })) {
        const intent = readIdField(charge.payment_intent);
        if (intent && charge.status === "succeeded") chargeByIntent.set(intent, charge);
    }
    const out: PaidInvoice[] = [];
    const invoices = stripe.invoices.list({ customer: customerId, status: "paid", limit: 100, expand: ["data.payments"] });
    for await (const invoice of invoices) {
        const periods = invoice.lines.data
            .filter(
                (li) =>
                    li.parent?.type === "subscription_item_details" &&
                    !li.parent.subscription_item_details?.proration &&
                    readIdField(li.pricing?.price_details?.product) === productId,
            )
            .map((li) => ({ startMs: li.period.start * 1000, endMs: li.period.end * 1000 }));
        if (periods.length === 0) continue;
        const intent = (invoice.payments?.data ?? []).map((p) => readIdField(p.payment?.payment_intent)).find(Boolean) ?? null;
        const charge = intent ? (chargeByIntent.get(intent) ?? null) : null;
        const amount = charge ? charge.amount : invoice.amount_paid;
        const disputeLost = await disputeLostOn(stripe, charge);
        out.push({
            periods,
            record: {
                kind: "monthly",
                paidMs: (invoice.status_transitions?.paid_at ?? invoice.created) * 1000,
                amount,
                refunded: disputeLost ? amount : charge ? Math.min(amount, charge.amount_refunded) : 0,
                currency: charge?.currency ?? invoice.currency,
                months: null,
                receiptUrl: receiptOf(charge) ?? (invoice.hosted_invoice_url?.startsWith("https://") ? invoice.hosted_invoice_url : null),
            },
        });
    }
    return out;
}

/** Every payment the customer made for the Velai product, prepaid and month to month, newest first. */
export async function readPaymentRecords(stripe: Stripe, customerId: string, productId: string): Promise<PaymentRecord[]> {
    const [sessions, invoices] = await Promise.all([
        readPaidSessions(stripe, customerId, productId),
        readPaidInvoices(stripe, customerId, productId),
    ]);
    return [...sessions.flatMap((p) => (p.record ? [p.record] : [])), ...invoices.map((i) => i.record)].sort((a, b) => b.paidMs - a.paidMs);
}

/** Where the account's month-to-month subscription stands, from Stripe now. */
export interface SubscriptionSummary {
    /** renewing: charged again at `periodEndMs`; ending: cancelled, runs to `periodEndMs`; past_due: the last charge failed. */
    state: "renewing" | "ending" | "past_due";
    periodEndMs: number;
}

const STATE_RANK: Record<SubscriptionSummary["state"], number> = { renewing: 0, past_due: 1, ending: 2 };

/** The subscription on the Velai product that matters most (renewing, then past due, then ending); null when there is none live. */
export async function readSubscriptionSummary(stripe: Stripe, customerId: string, productId: string): Promise<SubscriptionSummary | null> {
    let best: SubscriptionSummary | null = null;
    for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        const items = sub.items.data.filter((it) => readIdField(it.price?.product) === productId);
        if (items.length === 0) continue;
        const periodEndMs = Math.max(...items.map((it) => it.current_period_end)) * 1000;
        const ending = sub.cancel_at_period_end || sub.cancel_at !== null;
        const state: SubscriptionSummary["state"] | null =
            sub.status === "active" || sub.status === "trialing"
                ? ending
                    ? "ending"
                    : "renewing"
                : sub.status === "past_due" || sub.status === "unpaid"
                  ? "past_due"
                  : null;
        if (state && (!best || STATE_RANK[state] < STATE_RANK[best.state])) {
            best = { state, periodEndMs: state === "ending" && sub.cancel_at ? sub.cancel_at * 1000 : periodEndMs };
        }
    }
    return best;
}

/**
 * Recompute and store `access_until` (and whether a month-to-month subscription is live) for an
 * account; returns the stored end. Throws on any read or write failure.
 * A uid with no profile is skipped (returns 0, writes nothing). With no Stripe customer, payments are [] and Stripe is not called. `customerHint` (from a webhook or
 * the return page) is used only when the profile has no customer stored yet.
 */
export async function recomputeAccess(uid: string, customerHint: string | null = null, stripe: Stripe | null = getStripe()): Promise<number> {
    const profile = await readProfile(uid);
    if (!profile) {
        // An erased account: a late Stripe event must not recreate its billing record.
        console.warn("[billing] recompute skipped: no profile");
        return 0;
    }
    const { stripeCustomerId, grants } = shapeProfileBilling(profile);
    const customerId = stripeCustomerId ?? customerHint;
    let payments: PaymentFact[] = [];
    let renewals: RenewalFact[] = [];
    let autoRenew = false;
    if (customerId) {
        if (!stripe) throw new Error("Stripe is not configured");
        // Months count by product, so a future price must be created on the same Stripe product.
        const price = await stripe.prices.retrieve(readPriceId());
        const productId = readIdField(price.product) ?? "";
        const [paid, invoices, subscription] = await Promise.all([
            readPaymentFacts(stripe, customerId, productId),
            readPaidInvoices(stripe, customerId, productId),
            readSubscriptionSummary(stripe, customerId, productId),
        ]);
        payments = paid;
        renewals = invoices.flatMap(renewalsFromInvoice);
        autoRenew = subscription?.state === "renewing";
    }
    const folded = computeAccessUntil(accessEvents(payments, grants, renewals));
    // A live subscription carries slack so access doesn't lapse while the next charge settles.
    const accessUntil = autoRenew && folded > 0 ? folded + RENEWAL_GRACE_MS : folded;
    await writeAccessUntil(uid, accessUntil, stripeCustomerId ? null : customerId, autoRenew);
    return accessUntil;
}
