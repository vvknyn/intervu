"use client";

import { useEffect, useState } from "react";
import { fetchBillingAction } from "@/actions/billing";
import { SettingsInlineError } from "@/components/settings/SettingsInlineError";
import { SettingsSectionLoading } from "@/components/settings/SettingsSectionLoading";
import { Button } from "@/components/ui/button";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { formatPaidUntil, PRO_MONTHLY_PRICE } from "@/app/pricing/offer";
import { formatMoney, paymentStanding, type BillingView, type PaymentRow } from "@/lib/billing/billing-view";
import { settleAction } from "@/lib/load-result";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; billing: BillingView };

const PORTAL_ERROR = "The billing page didn't open. Try again in a minute.";

function subscriptionLine(sub: NonNullable<BillingView["subscription"]>): string {
    if (sub.state === "renewing") {
        return `Month to month is on. Next payment of ${PRO_MONTHLY_PRICE} on ${formatPaidUntil(sub.periodEndMs)}. Cancel any time.`;
    }
    if (sub.state === "ending") {
        return `Month to month is cancelled. Your access runs to ${formatPaidUntil(sub.periodEndMs)} and you won't be charged again.`;
    }
    return "Your last month-to-month payment didn't go through. Update your card to keep your access.";
}

function PaymentItem({ row }: { row: PaymentRow }) {
    const standing = paymentStanding(row);
    return (
        <li data-testid="payments-row" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
            <div className="min-w-0">
                <p className="font-semibold text-foreground">{row.label}</p>
                <p className="text-xs text-muted-foreground">{formatPaidUntil(row.paidMs)}</p>
            </div>
            <div className="flex items-baseline gap-3">
                <p className="text-foreground">
                    {formatMoney(row.amount, row.currency)}
                    {standing === "refunded" ? <span className="ml-2 text-xs text-muted-foreground">Refunded</span> : null}
                    {standing === "partly_refunded" ? (
                        <span className="ml-2 text-xs text-muted-foreground">{formatMoney(row.refunded, row.currency)} refunded</span>
                    ) : null}
                </p>
                {row.receiptUrl ? (
                    <a href={row.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                        Receipt
                    </a>
                ) : null}
            </div>
        </li>
    );
}

/** Settings › Account: every payment on the account, where month to month stands, and the door to Stripe's billing page. */
export function PaymentsSection() {
    const [load, setLoad] = useState<Load>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [opening, setOpening] = useState(false);
    const [portalError, setPortalError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void settleAction(fetchBillingAction()).then((res) => {
            if (live) setLoad(res.billing ? { status: "ready", billing: res.billing } : { status: "failed" });
        });
        return () => {
            live = false;
        };
    }, [attempt]);

    async function openPortal() {
        setOpening(true);
        setPortalError(null);
        try {
            const res = await fetch("/api/billing/portal", { method: "POST" });
            // load-result-allow: an unreadable reply falls to PORTAL_ERROR and the button comes back
            const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
            if (res.ok && body?.url) {
                window.location.assign(body.url);
                return;
            }
            setPortalError(body?.error ?? PORTAL_ERROR);
        } catch {
            setPortalError(PORTAL_ERROR);
        }
        setOpening(false);
    }

    return (
        <div data-testid="payments-card">
            <h2 className="mb-1 text-base font-semibold leading-snug">Payments</h2>
            {load.status === "loading" ? (
                <SettingsSectionLoading label="Loading your payments" />
            ) : load.status === "failed" ? (
                <LoadFailedState
                    title="We can't load your payments right now."
                    onRetry={() => {
                        setLoad({ status: "loading" });
                        setAttempt((n) => n + 1);
                    }}
                    testId="payments-error"
                    className="py-2"
                />
            ) : (
                <>
                    {load.billing.subscription ? (
                        <p
                            data-testid="payments-subscription"
                            data-state={load.billing.subscription.state}
                            className="mb-2 text-sm text-foreground"
                        >
                            {subscriptionLine(load.billing.subscription)}
                        </p>
                    ) : null}
                    {load.billing.payments.length === 0 ? (
                        <p data-testid="payments-empty" className="text-sm text-muted-foreground">
                            No payments yet.
                        </p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {load.billing.payments.map((row) => (
                                <PaymentItem key={`${row.paidMs}-${row.amount}`} row={row} />
                            ))}
                        </ul>
                    )}
                    {load.billing.canManage ? (
                        <div className="mt-3">
                            <Button data-testid="payments-manage" variant="outline" disabled={opening} onClick={() => void openPortal()}>
                                {opening ? "Opening…" : "Manage billing"}
                            </Button>
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                Update your card, cancel month to month, or see every invoice on Stripe.
                            </p>
                            {portalError ? (
                                <SettingsInlineError className="mt-2">
                                    <span data-testid="payments-portal-error">{portalError}</span>
                                </SettingsInlineError>
                            ) : null}
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}
