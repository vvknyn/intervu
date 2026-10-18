/**
 * Checkout / portal session builders and thin Stripe wrappers (inject client for tests).
 */
import type Stripe from "stripe";
import { isAllowedRedirectUrl } from "@/lib/billing/config";
import { VELAI_UID_METADATA_KEY } from "@/lib/billing/events";

export function makeIntegrationIdentifier(random8: string): string | { error: string } {
    if (!/^[a-z]{8}$/.test(random8)) {
        return { error: "invalid_integration_suffix" };
    }
    return `velai_checkout_${random8}`;
}

export type CheckoutSessionCreateParams = Stripe.Checkout.SessionCreateParams;

export interface BuildCheckoutSessionInput {
    uid: string;
    priceId: string;
    allowedPriceIds: readonly string[];
    successUrl: string;
    cancelUrl: string;
    integrationIdentifier: string;
    customerId?: string | null;
    email?: string | null;
}

export function buildCheckoutSessionParams(
    input: BuildCheckoutSessionInput,
): CheckoutSessionCreateParams | { error: string } {
    const {
        uid,
        priceId,
        allowedPriceIds,
        successUrl,
        cancelUrl,
        integrationIdentifier,
        customerId,
        email,
    } = input;

    if (!allowedPriceIds.length) return { error: "empty_allowlist" };
    if (!allowedPriceIds.includes(priceId)) return { error: "unknown_price" };
    if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
        return { error: "invalid_redirect_url" };
    }

    const params: CheckoutSessionCreateParams = {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: uid,
        success_url: successUrl,
        cancel_url: cancelUrl,
        integration_identifier: integrationIdentifier,
        subscription_data: {
            metadata: { [VELAI_UID_METADATA_KEY]: uid },
            billing_mode: { type: "flexible" },
        },
    };

    const customer = customerId?.trim();
    if (customer) {
        params.customer = customer;
    } else {
        const customerEmail = email?.trim();
        if (customerEmail) params.customer_email = customerEmail;
    }

    return params;
}

export interface BuildPortalSessionInput {
    customerId: string;
    returnUrl: string;
}

export type PortalSessionCreateParams = Stripe.BillingPortal.SessionCreateParams;

export function buildPortalSessionParams(
    input: BuildPortalSessionInput,
): PortalSessionCreateParams | { error: string } {
    const customerId = input.customerId?.trim();
    if (!customerId) return { error: "missing_customer" };
    if (!isAllowedRedirectUrl(input.returnUrl)) return { error: "invalid_return_url" };
    return {
        customer: customerId,
        return_url: input.returnUrl,
    };
}

export interface CheckoutStripeClient {
    checkout: {
        sessions: {
            create(params: CheckoutSessionCreateParams): Promise<{ id: string; url: string | null }>;
        };
    };
}

export interface PortalStripeClient {
    billingPortal: {
        sessions: {
            create(params: PortalSessionCreateParams): Promise<{ url: string }>;
        };
    };
}

export async function createCheckoutSession(
    stripe: CheckoutStripeClient,
    input: BuildCheckoutSessionInput,
): Promise<{ id: string; url: string | null } | { error: string }> {
    const built = buildCheckoutSessionParams(input);
    if ("error" in built) return built;
    return stripe.checkout.sessions.create(built);
}

export async function createPortalSession(
    stripe: PortalStripeClient,
    input: BuildPortalSessionInput,
): Promise<{ url: string } | { error: string }> {
    const built = buildPortalSessionParams(input);
    if ("error" in built) return built;
    const session = await stripe.billingPortal.sessions.create(built);
    return { url: session.url };
}
