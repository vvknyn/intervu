/**
 * Pure Stripe billing event reducer — no Stripe SDK or Firebase imports.
 */
import { isEntitledStatus } from "@/lib/billing/entitlement";

export const VELAI_UID_METADATA_KEY = "velai_uid";

export const UID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export interface BillingRecord {
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_subscription_status: string | null;
    stripe_current_period_end: number | null;
    billing_entitled: boolean;
    billing_updated_at: string;
    billing_event_created: number;
    stripe_last_payment_failed_at: string | null;
}

export function emptyBillingRecord(nowIso: string): BillingRecord {
    return {
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_subscription_status: null,
        stripe_current_period_end: null,
        billing_entitled: false,
        billing_updated_at: nowIso,
        billing_event_created: 0,
        stripe_last_payment_failed_at: null,
    };
}

export interface NormalizedStripeEvent {
    type: string;
    created: number;
    object: Record<string, unknown>;
}

const HANDLED_EVENT_TYPES = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
]);

export function normalizeStripeEvent(event: {
    id?: string;
    type: string;
    created: number;
    data: { object: unknown };
}): NormalizedStripeEvent | null {
    if (!event?.type || typeof event.created !== "number") return null;
    const object = event.data?.object;
    if (!object || typeof object !== "object") return null;
    return {
        type: event.type,
        created: event.created,
        object: object as Record<string, unknown>,
    };
}

export function validateVelaiUid(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return UID_PATTERN.test(trimmed) ? trimmed : null;
}

export function readIdField(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
        return (value as { id: string }).id;
    }
    return null;
}

export function readSubscriptionPeriodEnd(subscription: Record<string, unknown>): number | null {
    const root = subscription.current_period_end;
    if (typeof root === "number" && Number.isFinite(root)) return root;
    const items = subscription.items;
    if (!items || typeof items !== "object") return null;
    const data = (items as { data?: unknown }).data;
    if (!Array.isArray(data)) return null;
    let min: number | null = null;
    for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const end = (item as { current_period_end?: unknown }).current_period_end;
        if (typeof end === "number" && Number.isFinite(end)) {
            min = min === null ? end : Math.min(min, end);
        }
    }
    return min;
}

function eventIsoTimestamp(created: number): string {
    return new Date(created * 1000).toISOString();
}

export interface ReduceBillingResult {
    record: BillingRecord;
    /** Present when this event carries a validated uid (checkout client_reference_id or subscription metadata). */
    uid?: string | null;
    ignored?: boolean;
}

function isOutOfOrder(prev: BillingRecord, eventCreated: number): boolean {
    return eventCreated < prev.billing_event_created;
}

function mergeCustomerId(prev: BillingRecord, customerId: string | null): BillingRecord {
    if (!customerId || prev.stripe_customer_id) return prev;
    return { ...prev, stripe_customer_id: customerId };
}

function applySubscriptionFields(
    prev: BillingRecord,
    subscription: Record<string, unknown>,
    eventCreated: number,
    nowIso: string,
): BillingRecord {
    const customerId = readIdField(subscription.customer);
    const subscriptionId = typeof subscription.id === "string" ? subscription.id : null;
    const status =
        typeof subscription.status === "string" ? subscription.status : prev.stripe_subscription_status;
    const periodEnd = readSubscriptionPeriodEnd(subscription);
    const entitled = isEntitledStatus(status);

    let next: BillingRecord = {
        ...prev,
        stripe_subscription_status: status,
        stripe_current_period_end: periodEnd ?? prev.stripe_current_period_end,
        billing_entitled: entitled,
        billing_updated_at: nowIso,
        billing_event_created: eventCreated,
    };
    if (customerId) next.stripe_customer_id = customerId;
    if (subscriptionId) next.stripe_subscription_id = subscriptionId;
    return next;
}

/**
 * Checkout links the Stripe customer to a user. It must not move
 * `billing_event_created`: that cursor orders subscription lifecycle events
 * only. Checkout is often created *after* `customer.subscription.created`
 * (later `created` timestamp) and can be delivered first — advancing the
 * cursor here would drop the subscription event and leave entitlement unset.
 */
function handleCheckoutSession(
    prev: BillingRecord,
    session: Record<string, unknown>,
    nowIso: string,
): ReduceBillingResult {
    const uid = validateVelaiUid(session.client_reference_id);
    const customerId = readIdField(session.customer);
    const subscriptionId = readIdField(session.subscription);

    let record = mergeCustomerId(prev, customerId);
    if (subscriptionId && !record.stripe_subscription_id) {
        record = { ...record, stripe_subscription_id: subscriptionId };
    }
    if (record !== prev) {
        record = { ...record, billing_updated_at: nowIso };
    }

    return { record, uid };
}

function handleSubscriptionEvent(
    prev: BillingRecord,
    subscription: Record<string, unknown>,
    eventCreated: number,
    nowIso: string,
    deleted: boolean,
): ReduceBillingResult {
    const metadata = subscription.metadata;
    const uid =
        metadata && typeof metadata === "object"
            ? validateVelaiUid((metadata as Record<string, unknown>)[VELAI_UID_METADATA_KEY])
            : null;

    if (isOutOfOrder(prev, eventCreated)) {
        const customerId = readIdField(subscription.customer);
        return {
            record: mergeCustomerId(prev, customerId),
            uid,
        };
    }

    let record = applySubscriptionFields(prev, subscription, eventCreated, nowIso);
    if (deleted) {
        const status =
            typeof subscription.status === "string" ? subscription.status : record.stripe_subscription_status;
        record = {
            ...record,
            stripe_subscription_status: status,
            billing_entitled: false,
        };
    }

    return { record, uid };
}

function handleInvoicePaymentFailed(
    prev: BillingRecord,
    eventCreated: number,
    nowIso: string,
): ReduceBillingResult {
    const failedAt = eventIsoTimestamp(eventCreated);
    if (prev.stripe_last_payment_failed_at && prev.stripe_last_payment_failed_at >= failedAt) {
        return { record: prev };
    }
    return {
        record: {
            ...prev,
            stripe_last_payment_failed_at: failedAt,
            billing_updated_at: nowIso,
        },
    };
}

export function isHandledBillingEventType(type: string): boolean {
    return HANDLED_EVENT_TYPES.has(type);
}

export function fallbackUidFromEvent(event: NormalizedStripeEvent): string | null {
    const { object, type } = event;
    if (type.startsWith("checkout.session.")) {
        return validateVelaiUid(object.client_reference_id);
    }
    if (type.startsWith("customer.subscription.")) {
        const metadata = object.metadata;
        if (metadata && typeof metadata === "object") {
            return validateVelaiUid((metadata as Record<string, unknown>)[VELAI_UID_METADATA_KEY]);
        }
    }
    return null;
}

export function reduceBillingEvent(
    prev: BillingRecord,
    event: NormalizedStripeEvent,
    nowIso: string,
): ReduceBillingResult {
    if (!HANDLED_EVENT_TYPES.has(event.type)) {
        return { record: prev, ignored: true };
    }

    const { object, type, created } = event;

    switch (type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
            return handleCheckoutSession(prev, object, nowIso);
        case "checkout.session.async_payment_failed":
            return { record: prev, uid: validateVelaiUid(object.client_reference_id) };
        case "customer.subscription.created":
        case "customer.subscription.updated":
            return handleSubscriptionEvent(prev, object, created, nowIso, false);
        case "customer.subscription.deleted":
            return handleSubscriptionEvent(prev, object, created, nowIso, true);
        case "invoice.payment_failed":
            return handleInvoicePaymentFailed(prev, created, nowIso);
        default:
            return { record: prev, ignored: true };
    }
}
