/**
 * Injectable Stripe webhook processor: verify, route the access events, recompute. No SDK or database imports.
 */
import { RECOMPUTE_EVENT_TYPES, recomputeTargetFromObject } from "@/lib/billing/events";
import { describeStripeError } from "@/lib/billing/stripe-error";

export interface WebhookDeps {
    findUidByCustomerId(customerId: string): Promise<string | null>;
    recompute(uid: string, customerId: string): Promise<unknown>;
    /** The customer a charge belongs to (disputes name only the charge). */
    customerIdOfCharge(chargeId: string): Promise<string | null>;
    /** Counts-only diagnostics: never an id or an email. */
    log(line: string): void;
}

export interface HandleStripeWebhookInput {
    payload: string;
    signature: string | null;
    webhookSecret: string | undefined;
    constructEvent: (payload: string, signature: string, secret: string) => unknown;
    deps: WebhookDeps;
}

export async function handleStripeWebhook(
    input: HandleStripeWebhookInput,
): Promise<{ status: number; body: { received?: true; error?: string } }> {
    const secret = input.webhookSecret?.trim();
    if (!secret) return { status: 503, body: { error: "not_configured" } };

    const signature = input.signature?.trim();
    if (!signature) return { status: 400, body: { error: "invalid_signature" } };

    let event: { type?: unknown; data?: { object?: unknown } };
    try {
        event = input.constructEvent(input.payload, signature, secret) as typeof event;
    } catch {
        return { status: 400, body: { error: "invalid_signature" } };
    }

    const object = event?.data?.object;
    if (typeof event?.type !== "string" || !RECOMPUTE_EVENT_TYPES.has(event.type) || !object || typeof object !== "object") {
        return { status: 200, body: { received: true } };
    }

    const target = recomputeTargetFromObject(event.type, object as Record<string, unknown>);

    try {
        const customerId = target.customerId ?? (target.chargeId ? await input.deps.customerIdOfCharge(target.chargeId) : null);
        const uid = customerId ? ((await input.deps.findUidByCustomerId(customerId)) ?? target.fallbackUid) : null;
        if (customerId && uid) await input.deps.recompute(uid, customerId);
        else input.deps.log(`[stripe-webhook] unmatched event type=${event.type} customer=${customerId ? "yes" : "no"} uid=${uid ? "yes" : "no"}`);
    } catch (error) {
        input.deps.log(`[stripe-webhook] recompute failed type=${event.type}: ${describeStripeError(error)}`);
        // 500 makes Stripe retry; the recompute is idempotent, so a retry is always safe.
        return { status: 500, body: { error: "processing_failed" } };
    }
    return { status: 200, body: { received: true } };
}
