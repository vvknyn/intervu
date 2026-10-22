/**
 * Pure billing entitlement helpers — no Stripe or Firebase imports.
 */

/** Subscription statuses that grant access (fail closed for everything else). */
export function isEntitledStatus(status: string | null | undefined): boolean {
    return status === "active" || status === "trialing";
}

/** Reads the persisted entitlement flag from a profile document shape. */
export function readBillingEntitlement(data: Record<string, unknown> | null | undefined): boolean {
    return data?.billing_entitled === true;
}
