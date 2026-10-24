/**
 * access_until is RECOMPUTED from Stripe's own record of the customer's paid
 * Checkout Sessions, never incremented: a replayed or reordered event cannot
 * change the answer, and a refund is just another fact the next read sees.
 */
import type Stripe from "stripe";
import { readPriceId } from "@/lib/billing/config";
import { priceMatchesOffer } from "@/lib/billing/checkout";
import { getStripe } from "@/lib/billing/stripe-client";
import { readIdField } from "@/lib/billing/events";
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

export const accessEvents = (payments: readonly PaymentFact[], grants: readonly Grant[]): AccessEvent[] => [
    ...payments.map((p) => ({ at: p.createdMs, durationMs: p.months * MONTH_MS })),
    ...grants.map((g) => ({ at: g.at, durationMs: g.days * DAY_MS })),
];

export interface SessionFacts {
    mode: string;
    status: string | null;
    paymentStatus: string;
    /** Quantity of every line item bought at the Velai product at the $12 offer. */
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

async function sessionFacts(stripe: Stripe, session: Stripe.Checkout.Session, productId: string): Promise<SessionFacts> {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    const pricedQuantity = items.data
        .filter((li) => readIdField(li.price?.product) === productId && !!li.price && priceMatchesOffer(li.price))
        .reduce((sum, li) => sum + (li.quantity ?? 0), 0);
    const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const disputeLost = charge?.disputed
        ? (await stripe.disputes.list({ charge: charge.id, limit: 100 })).data.some((d) => d.status === "lost")
        : false;
    return {
        mode: session.mode,
        status: session.status,
        paymentStatus: session.payment_status,
        pricedQuantity,
        charged: charge ? charge.amount : session.amount_total,
        refunded: charge ? charge.amount_refunded : 0,
        disputeLost,
    };
}

/** Thin Stripe reader: every payment-mode session the customer completed, as dated month counts. */
export async function readPaymentFacts(stripe: Stripe, customerId: string, productId: string): Promise<PaymentFact[]> {
    const facts: PaymentFact[] = [];
    const sessions = stripe.checkout.sessions.list({
        customer: customerId,
        status: "complete",
        limit: 100,
        expand: ["data.payment_intent.latest_charge"],
    });
    for await (const session of sessions) {
        const months = monthsFromSession(await sessionFacts(stripe, session, productId));
        if (months > 0) facts.push({ createdMs: session.created * 1000, months });
    }
    return facts;
}

/**
 * Recompute and store `access_until` for an account; returns it. Throws on any read or write failure.
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
    if (customerId) {
        if (!stripe) throw new Error("Stripe is not configured");
        const price = await stripe.prices.retrieve(readPriceId());
        payments = await readPaymentFacts(stripe, customerId, readIdField(price.product) ?? "");
    }
    const accessUntil = computeAccessUntil(accessEvents(payments, grants));
    await writeAccessUntil(uid, accessUntil, stripeCustomerId ? null : customerId);
    return accessUntil;
}
