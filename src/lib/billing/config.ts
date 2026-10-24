/**
 * Stripe billing env. Three server-only values; the client never sends a price.
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
