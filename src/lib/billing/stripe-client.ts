/**
 * Server-only Stripe client — returns null when billing is not configured.
 */
import Stripe from "stripe";

const API_VERSION = "2026-09-30.endive" as Stripe.LatestApiVersion;

let cachedKey: string | null = null;
let cachedClient: Stripe | null = null;

export function getStripe(): Stripe | null {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) return null;
    if (cachedClient && cachedKey === secretKey) return cachedClient;
    cachedKey = secretKey;
    cachedClient = new Stripe(secretKey, {
        apiVersion: API_VERSION,
        appInfo: { name: "Velai", url: "https://velai.app" },
    });
    return cachedClient;
}

export { API_VERSION as STRIPE_API_VERSION };
