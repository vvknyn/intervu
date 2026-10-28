/**
 * Checkout Session params for the two ways to pay: prepaid months (one-time payment, 1-12 months,
 * never renews) and, as an opt-in, month to month (a subscription that renews until cancelled).
 * The displayed price (offer.ts) must equal the charged price: both starts refuse otherwise.
 */
import type Stripe from "stripe";
import { MAX_MONTHS, MIN_MONTHS, MONTH_PRICE_USD } from "@/app/pricing/offer";
import { VELAI_UID_METADATA_KEY } from "@/lib/billing/events";

export function parseMonths(raw: unknown): number | null {
    const months = raw === undefined ? MIN_MONTHS : raw;
    return typeof months === "number" && Number.isInteger(months) && months >= MIN_MONTHS && months <= MAX_MONTHS
        ? months
        : null;
}

export interface BuildCheckoutInput {
    uid: string;
    months: number;
    priceId: string;
    origin: string;
    customerId: string;
}

export function buildCheckoutParams(input: BuildCheckoutInput): Stripe.Checkout.SessionCreateParams {
    const { uid, months, priceId, origin, customerId } = input;
    return {
        mode: "payment",
        line_items: [
            {
                price: priceId,
                quantity: months,
                adjustable_quantity: { enabled: true, minimum: MIN_MONTHS, maximum: MAX_MONTHS },
            },
        ],
        customer: customerId,
        client_reference_id: uid,
        metadata: { [VELAI_UID_METADATA_KEY]: uid },
        payment_intent_data: { metadata: { [VELAI_UID_METADATA_KEY]: uid } },
        success_url: `${origin}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        // The account defaults to Stripe as merchant of record; Velai is the seller here, and turning MoR on is a separate paid decision.
        managed_payments: { enabled: false },
    };
}

export interface BuildSubscriptionCheckoutInput {
    uid: string;
    priceId: string;
    origin: string;
    customerId: string;
}

/** Month to month: one monthly Price, quantity 1, the uid stamped on the subscription so its invoices and events name the account. */
export function buildSubscriptionCheckoutParams(input: BuildSubscriptionCheckoutInput): Stripe.Checkout.SessionCreateParams {
    const { uid, priceId, origin, customerId } = input;
    return {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        customer: customerId,
        client_reference_id: uid,
        metadata: { [VELAI_UID_METADATA_KEY]: uid },
        subscription_data: { metadata: { [VELAI_UID_METADATA_KEY]: uid } },
        success_url: `${origin}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        managed_payments: { enabled: false },
    };
}

/** Pure: the Stripe price must be exactly the offer shown on /pricing. */
export function priceMatchesOffer(price: { unit_amount: number | null; currency: string }): boolean {
    return price.unit_amount === MONTH_PRICE_USD * 100 && price.currency === "usd";
}

interface CustomerDeps {
    stripe: { customers: { create(params: Stripe.CustomerCreateParams, options: { idempotencyKey: string }): Promise<{ id: string }> } };
    readCustomerId(uid: string): Promise<string | null>;
    storeCustomerId(uid: string, customerId: string): Promise<void>;
}

export interface StartCheckoutDeps extends CustomerDeps {
    stripe: CustomerDeps["stripe"] & {
        prices: { retrieve(id: string): Promise<{ unit_amount: number | null; currency: string }> };
        checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }> } };
    };
    log(line: string): void;
}

export type StartCheckoutResult =
    | { status: 200; body: { url: string } }
    | { status: 409 | 503; body: { error: string } };

/** The account's ONE Stripe customer: reused, or created (idempotently) and stored before any session names it. */
async function ensureCustomer(deps: CustomerDeps, uid: string): Promise<string> {
    const stored = await deps.readCustomerId(uid);
    if (stored) return stored;
    const created = (
        await deps.stripe.customers.create({ metadata: { [VELAI_UID_METADATA_KEY]: uid } }, { idempotencyKey: `velai-customer-${uid}` })
    ).id;
    await deps.storeCustomerId(uid, created);
    return created;
}

/** Reuses or creates the account's ONE Stripe customer first, then opens a session that always names it. */
export async function startCheckout(
    deps: StartCheckoutDeps,
    input: { uid: string; months: number; priceId: string; origin: string },
): Promise<StartCheckoutResult> {
    const price = await deps.stripe.prices.retrieve(input.priceId);
    if (!priceMatchesOffer(price)) {
        deps.log(`[checkout] price mismatch: stripe=${price.unit_amount}/${price.currency} offer=${MONTH_PRICE_USD * 100}/usd`);
        return { status: 503, body: { error: "Checkout is unavailable right now. Please try again later." } };
    }

    const customerId = await ensureCustomer(deps, input.uid);
    const session = await deps.stripe.checkout.sessions.create(buildCheckoutParams({ ...input, customerId }));
    if (!session.url) return { status: 503, body: { error: "Checkout could not start." } };
    return { status: 200, body: { url: session.url } };
}

/** Subscription statuses that still bill or may still bill: a second subscription would double-charge. */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);

export interface StartSubscriptionDeps extends CustomerDeps {
    stripe: CustomerDeps["stripe"] & {
        prices: {
            retrieve(id: string): Promise<{
                unit_amount: number | null;
                currency: string;
                recurring: { interval: string; interval_count: number } | null;
            }>;
        };
        subscriptions: { list(params: { customer: string; status: "all"; limit: number }): Promise<{ data: { status: string }[] }> };
        checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }> } };
    };
    log(line: string): void;
}

/** Pure: the recurring Price must be the offer shown on /pricing, billed every one month. */
export function subscriptionPriceMatchesOffer(price: {
    unit_amount: number | null;
    currency: string;
    recurring: { interval: string; interval_count: number } | null;
}): boolean {
    return (
        priceMatchesOffer(price) &&
        price.recurring?.interval === "month" &&
        price.recurring.interval_count === 1
    );
}

/** Month to month. Refuses a second subscription for an account that already has one live (it manages that one in the portal). */
export async function startSubscriptionCheckout(
    deps: StartSubscriptionDeps,
    input: { uid: string; priceId: string; origin: string },
): Promise<StartCheckoutResult> {
    const price = await deps.stripe.prices.retrieve(input.priceId);
    if (!subscriptionPriceMatchesOffer(price)) {
        deps.log(
            `[checkout] subscription price mismatch: stripe=${price.unit_amount}/${price.currency}/${price.recurring?.interval_count}${price.recurring?.interval} offer=${MONTH_PRICE_USD * 100}/usd/1month`,
        );
        return { status: 503, body: { error: "Checkout is unavailable right now. Please try again later." } };
    }

    const customerId = await ensureCustomer(deps, input.uid);
    const existing = await deps.stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    if (existing.data.some((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status))) {
        return { status: 409, body: { error: "Month to month is already on for this account. Manage it in Settings." } };
    }
    const session = await deps.stripe.checkout.sessions.create(buildSubscriptionCheckoutParams({ ...input, customerId }));
    if (!session.url) return { status: 503, body: { error: "Checkout could not start." } };
    return { status: 200, body: { url: session.url } };
}

export interface StartPortalDeps {
    stripe: { billingPortal: { sessions: { create(params: { customer: string; return_url: string }): Promise<{ url: string }> } } };
    readCustomerId(uid: string): Promise<string | null>;
}

/** Stripe's hosted billing page for the account's customer: update the card, cancel month to month, see invoices. */
export async function startPortal(
    deps: StartPortalDeps,
    input: { uid: string; origin: string },
): Promise<{ status: 200; body: { url: string } } | { status: 404; body: { error: string } }> {
    const customerId = await deps.readCustomerId(input.uid);
    if (!customerId) return { status: 404, body: { error: "There is no billing to manage yet." } };
    const session = await deps.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${input.origin}/settings?tab=account`,
    });
    return { status: 200, body: { url: session.url } };
}
