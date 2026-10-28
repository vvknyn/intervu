/**
 * Stripe billing env. Server-only values; the client never sends a price.
 */
export function isBillingConfigured(env: Record<string, string | undefined> = process.env): boolean {
    return Boolean(
        env.STRIPE_SECRET_KEY?.trim() && env.STRIPE_WEBHOOK_SECRET?.trim() && env.STRIPE_PRICE_ID?.trim(),
    );
}

/** The one prepaid-month price. Callers check `isBillingConfigured()` first. */
export function readPriceId(env: Record<string, string | undefined> = process.env): string {
    const priceId = env.STRIPE_PRICE_ID?.trim();
    if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
    return priceId;
}

/**
 * Month-to-month is optional on top of billing: it needs its own recurring monthly Price
 * (Stripe cannot sell a one-time Price in subscription mode). Unset, the option stays hidden.
 */
export function isAutoRenewConfigured(env: Record<string, string | undefined> = process.env): boolean {
    return isBillingConfigured(env) && Boolean(env.STRIPE_SUBSCRIPTION_PRICE_ID?.trim());
}

/** The recurring monthly price. Callers check `isAutoRenewConfigured()` first. */
export function readSubscriptionPriceId(env: Record<string, string | undefined> = process.env): string {
    const priceId = env.STRIPE_SUBSCRIPTION_PRICE_ID?.trim();
    if (!priceId) throw new Error("STRIPE_SUBSCRIPTION_PRICE_ID is not set");
    return priceId;
}
