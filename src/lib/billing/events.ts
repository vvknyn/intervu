/**
 * Stripe webhook routing: which events trigger a recompute, and which customer / account they name.
 * Pure — no Stripe SDK or database imports.
 */
export const VELAI_UID_METADATA_KEY = "velai_uid";

export const UID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function validateVelaiUid(uid: unknown): uid is string {
    return typeof uid === "string" && UID_PATTERN.test(uid);
}

/** The only events that move access; every other type is acknowledged and ignored. */
export const RECOMPUTE_EVENT_TYPES: ReadonlySet<string> = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "charge.refunded",
    "charge.dispute.closed",
]);

export function readIdField(value: unknown): string | null {
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
        return (value as { id: string }).id || null;
    }
    return null;
}

export interface RecomputeTarget {
    customerId: string | null;
    /** A dispute names its charge, not its customer; the charge's customer is looked up. */
    chargeId: string | null;
    /** The uid Velai stamped on the object at checkout, validated; null when absent or malformed. */
    fallbackUid: string | null;
}

export function recomputeTargetFromObject(type: string, object: Record<string, unknown>): RecomputeTarget {
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    const candidates = type.startsWith("checkout.session.")
        ? [object.client_reference_id, metadata[VELAI_UID_METADATA_KEY]]
        : [metadata[VELAI_UID_METADATA_KEY]];
    return {
        customerId: readIdField(object.customer),
        chargeId: type.startsWith("charge.dispute.") ? readIdField(object.charge) : null,
        fallbackUid: candidates.find(validateVelaiUid) ?? null,
    };
}
