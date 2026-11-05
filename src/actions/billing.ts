"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { EMPTY_BILLING, paymentRows, type BillingView } from "@/lib/billing/billing-view";
import { isBillingConfigured, readPriceId } from "@/lib/billing/config";
import { readIdField } from "@/lib/billing/events";
import { readProfileBilling } from "@/lib/billing/profile-store";
import { readMonthlyOrNone, readPaymentRecords, readSubscriptionSummary } from "@/lib/billing/recompute";
import { getStripe } from "@/lib/billing/stripe-client";
import { describeStripeError } from "@/lib/billing/stripe-error";

/**
 * This account's payments and month-to-month state, read from Stripe, for Settings › Account.
 * No Stripe customer yet is a real empty answer (nothing paid); a customer Stripe cannot be
 * asked about, or a failed read, is `{error}`, never "no payments".
 */
export async function fetchBillingAction(): Promise<{ billing?: BillingView; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "no-session" };
    try {
        const { stripeCustomerId } = await readProfileBilling(user.uid);
        if (!stripeCustomerId) return { billing: EMPTY_BILLING };
        const stripe = getStripe();
        if (!stripe || !isBillingConfigured()) return { error: "Couldn't load your payments" };
        const price = await stripe.prices.retrieve(readPriceId());
        const productId = readIdField(price.product) ?? "";
        const [records, subscription] = await Promise.all([
            readPaymentRecords(stripe, stripeCustomerId, productId),
            readMonthlyOrNone(() => readSubscriptionSummary(stripe, stripeCustomerId, productId), null, "subscriptions"),
        ]);
        return { billing: { payments: paymentRows(records), subscription, canManage: true } };
    } catch (error) {
        console.error(`[billing] payments read failed: ${describeStripeError(error)}`);
        return { error: "Couldn't load your payments" };
    }
}
