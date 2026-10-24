/**
 * Checkout Session params for prepaid months: one-time payment, 1-12 months, no auto-renew.
 * The displayed price (offer.ts) must equal the charged price: `startCheckout` refuses otherwise.
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
    };
}

/** Pure: the Stripe price must be exactly the offer shown on /pricing. */
export function priceMatchesOffer(price: { unit_amount: number | null; currency: string }): boolean {
    return price.unit_amount === MONTH_PRICE_USD * 100 && price.currency === "usd";
}

export interface StartCheckoutDeps {
    stripe: {
        prices: { retrieve(id: string): Promise<{ unit_amount: number | null; currency: string }> };
        customers: { create(params: Stripe.CustomerCreateParams, options: { idempotencyKey: string }): Promise<{ id: string }> };
        checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }> } };
    };
    readCustomerId(uid: string): Promise<string | null>;
    storeCustomerId(uid: string, customerId: string): Promise<void>;
    log(line: string): void;
}

export type StartCheckoutResult = { status: 200; body: { url: string } } | { status: 503; body: { error: string } };

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

    let customerId = await deps.readCustomerId(input.uid);
    if (!customerId) {
        customerId = (
            await deps.stripe.customers.create(
                { metadata: { [VELAI_UID_METADATA_KEY]: input.uid } },
                { idempotencyKey: `velai-customer-${input.uid}` },
            )
        ).id;
        await deps.storeCustomerId(input.uid, customerId);
    }
    const session = await deps.stripe.checkout.sessions.create(buildCheckoutParams({ ...input, customerId }));
    if (!session.url) return { status: 503, body: { error: "Checkout could not start." } };
    return { status: 200, body: { url: session.url } };
}
