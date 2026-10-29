/**
 * What Settings shows of an account's payments. Pure and client-safe (types only from the server
 * modules): the server action turns Stripe's record into this, the card only renders it.
 */
import { monthsLabel } from "@/app/pricing/offer";
import type { PaymentRecord, SubscriptionSummary } from "@/lib/billing/recompute";

export interface PaymentRow {
    paidMs: number;
    /** What the payment bought: "3 months" or "Month to month". */
    label: string;
    /** Minor units of `currency` (cents). */
    amount: number;
    refunded: number;
    currency: string;
    receiptUrl: string | null;
}

export interface BillingView {
    payments: PaymentRow[];
    subscription: SubscriptionSummary | null;
    /** The account has a Stripe customer, so Stripe's billing page has something to open. */
    canManage: boolean;
}

export const EMPTY_BILLING: BillingView = { payments: [], subscription: null, canManage: false };

export function paymentRows(records: readonly PaymentRecord[]): PaymentRow[] {
    return records
        .map((r) => ({
            paidMs: r.paidMs,
            label: r.kind === "monthly" ? "Month to month" : monthsLabel(Math.max(1, r.months ?? 1)),
            amount: r.amount,
            refunded: r.refunded,
            currency: r.currency,
            receiptUrl: r.receiptUrl,
        }))
        .sort((a, b) => b.paidMs - a.paidMs);
}

export type PaymentStanding = "paid" | "partly_refunded" | "refunded";

export function paymentStanding(row: Pick<PaymentRow, "amount" | "refunded">): PaymentStanding {
    if (row.refunded <= 0) return "paid";
    return row.refunded >= row.amount ? "refunded" : "partly_refunded";
}

export function formatMoney(minor: number, currency: string): string {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
    } catch {
        return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }
}
