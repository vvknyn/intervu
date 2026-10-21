/**
 * Firestore billing fields on `profiles/{uid}` — server-only.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { readBillingEntitlement } from "@/lib/billing/entitlement";
import type { BillingRecord } from "@/lib/billing/events";

function snakeFromRecord(record: BillingRecord): Record<string, unknown> {
    return {
        stripe_customer_id: record.stripe_customer_id,
        stripe_subscription_id: record.stripe_subscription_id,
        stripe_subscription_status: record.stripe_subscription_status,
        stripe_current_period_end: record.stripe_current_period_end,
        billing_entitled: record.billing_entitled,
        billing_updated_at: record.billing_updated_at,
        billing_event_created: record.billing_event_created,
        stripe_last_payment_failed_at: record.stripe_last_payment_failed_at,
    };
}

function recordFromSnake(data: Record<string, unknown> | undefined, fallbackUpdatedAt: string): BillingRecord {
    return {
        stripe_customer_id: typeof data?.stripe_customer_id === "string" ? data.stripe_customer_id : null,
        stripe_subscription_id:
            typeof data?.stripe_subscription_id === "string" ? data.stripe_subscription_id : null,
        stripe_subscription_status:
            typeof data?.stripe_subscription_status === "string" ? data.stripe_subscription_status : null,
        stripe_current_period_end:
            typeof data?.stripe_current_period_end === "number" ? data.stripe_current_period_end : null,
        billing_entitled: data?.billing_entitled === true,
        billing_updated_at:
            typeof data?.billing_updated_at === "string" ? data.billing_updated_at : fallbackUpdatedAt,
        billing_event_created:
            typeof data?.billing_event_created === "number" ? data.billing_event_created : 0,
        stripe_last_payment_failed_at:
            typeof data?.stripe_last_payment_failed_at === "string"
                ? data.stripe_last_payment_failed_at
                : null,
    };
}

export async function getBillingEntitlement(uid: string): Promise<boolean> {
    try {
        const snap = await getAdminDb().collection("profiles").doc(uid).get();
        if (!snap.exists) return false;
        return readBillingEntitlement(snap.data());
    } catch {
        return false;
    }
}

export async function findUidByStripeCustomerId(customerId: string): Promise<string | null> {
    const snap = await getAdminDb()
        .collection("profiles")
        .where("stripe_customer_id", "==", customerId)
        .limit(1)
        .get();
    if (snap.empty) return null;
    return snap.docs[0]?.id ?? null;
}

export async function readBillingRecord(uid: string): Promise<BillingRecord | null> {
    const snap = await getAdminDb().collection("profiles").doc(uid).get();
    if (!snap.exists) return null;
    return recordFromSnake(snap.data(), new Date().toISOString());
}

export async function writeBillingRecord(uid: string, record: BillingRecord): Promise<void> {
    await getAdminDb().collection("profiles").doc(uid).set(snakeFromRecord(record), { merge: true });
}

/** Store adapter for the webhook handler. */
export const billingProfileStore = {
    findUidByCustomerId: findUidByStripeCustomerId,
    readBilling: readBillingRecord,
    writeBilling: writeBillingRecord,
};
