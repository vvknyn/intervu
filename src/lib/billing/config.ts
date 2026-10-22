/**
 * Pure Stripe billing env parsing — pass `process.env` from routes; no side effects.
 */

const LOCALHOST_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;

export function isAllowedRedirectUrl(url: string): boolean {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "https:") return true;
        if (parsed.protocol === "http:" && LOCALHOST_HTTP.test(trimmed)) return true;
        return false;
    } catch {
        return false;
    }
}

export function parseStripePriceIds(raw: string | undefined): string[] {
    if (!raw || typeof raw !== "string") return [];
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

export interface StripeBillingEnv {
    secretKey: string | null;
    webhookSecret: string | null;
    priceIds: string[];
    checkoutSuccessUrl: string | null;
    checkoutCancelUrl: string | null;
    portalReturnUrl: string | null;
}

export function readStripeBillingEnv(env: Record<string, string | undefined>): StripeBillingEnv {
    const secretKey = env.STRIPE_SECRET_KEY?.trim() || null;
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
    const priceIds = parseStripePriceIds(env.STRIPE_PRICE_IDS);
    const checkoutSuccessUrl = env.STRIPE_CHECKOUT_SUCCESS_URL?.trim() || null;
    const checkoutCancelUrl = env.STRIPE_CHECKOUT_CANCEL_URL?.trim() || null;
    const portalReturnUrl = env.STRIPE_PORTAL_RETURN_URL?.trim() || null;
    return {
        secretKey,
        webhookSecret,
        priceIds,
        checkoutSuccessUrl,
        checkoutCancelUrl,
        portalReturnUrl,
    };
}

export function isCheckoutConfigured(env: StripeBillingEnv): boolean {
    return Boolean(
        env.secretKey &&
            env.priceIds.length > 0 &&
            env.checkoutSuccessUrl &&
            isAllowedRedirectUrl(env.checkoutSuccessUrl) &&
            env.checkoutCancelUrl &&
            isAllowedRedirectUrl(env.checkoutCancelUrl),
    );
}

export function isPortalConfigured(env: StripeBillingEnv): boolean {
    return Boolean(env.secretKey && env.portalReturnUrl && isAllowedRedirectUrl(env.portalReturnUrl));
}
