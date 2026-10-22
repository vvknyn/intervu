/**
 * Injectable Stripe webhook processor — no Firebase imports.
 */
import {
    emptyBillingRecord,
    fallbackUidFromEvent,
    isHandledBillingEventType,
    normalizeStripeEvent,
    readIdField,
    reduceBillingEvent,
    type BillingRecord,
    type NormalizedStripeEvent,
} from "@/lib/billing/events";

export interface BillingWebhookStore {
    findUidByCustomerId(customerId: string): Promise<string | null>;
    readBilling(uid: string): Promise<BillingRecord | null>;
    writeBilling(uid: string, record: BillingRecord): Promise<void>;
}

export interface HandleStripeWebhookInput {
    payload: string;
    signature: string | null;
    webhookSecret: string | undefined;
    constructEvent: (payload: string, signature: string, secret: string) => unknown;
    store: BillingWebhookStore;
    nowIso: string;
}

function customerIdFromEvent(event: NormalizedStripeEvent): string | null {
    const { object, type } = event;
    if (type.startsWith("customer.subscription.")) {
        return readIdField(object.customer);
    }
    if (type.startsWith("checkout.session.")) {
        return readIdField(object.customer);
    }
    if (type === "invoice.payment_failed") {
        return readIdField(object.customer);
    }
    return null;
}

export async function handleStripeWebhook(
    input: HandleStripeWebhookInput,
): Promise<{ status: number; body: { received?: true; error?: string } }> {
    const secret = input.webhookSecret?.trim();
    if (!secret) {
        return { status: 503, body: { error: "not_configured" } };
    }

    const signature = input.signature?.trim();
    if (!signature) {
        return { status: 400, body: { error: "invalid_signature" } };
    }

    let rawEvent: unknown;
    try {
        rawEvent = input.constructEvent(input.payload, signature, secret);
    } catch {
        return { status: 400, body: { error: "invalid_signature" } };
    }

    const event = normalizeStripeEvent(
        rawEvent as { type: string; created: number; data: { object: unknown } },
    );
    if (!event) {
        return { status: 200, body: { received: true } };
    }

    if (!isHandledBillingEventType(event.type)) {
        return { status: 200, body: { received: true } };
    }

    const customerId = customerIdFromEvent(event);
    let uid: string | null = null;
    if (customerId) {
        uid = await input.store.findUidByCustomerId(customerId);
    }
    if (!uid) {
        uid = fallbackUidFromEvent(event);
    }

    if (!uid) {
        return { status: 200, body: { received: true } };
    }

    const existing = (await input.store.readBilling(uid)) ?? emptyBillingRecord(input.nowIso);
    const applied = reduceBillingEvent(existing, event, input.nowIso);

    try {
        await input.store.writeBilling(uid, applied.record);
    } catch {
        return { status: 500, body: { error: "processing_failed" } };
    }

    return { status: 200, body: { received: true } };
}
