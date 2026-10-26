"use client";

import Link from "next/link";
import { formatPaidUntil, PRO_MONTHLY_PRICE } from "@/app/pricing/offer";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/account/plan";
import { DELETE_AFTER_DAYS } from "@/lib/retention/delete-after";
import { PRIVACY_MODES } from "@/lib/privacy-modes";

const FREE_LINE = "Search, matching with a résumé kept on your device, the tracker and saved jobs are free.";
const FULL_LINE = `When it ends, search and on-device matching stay free. A résumé saved on Velai is deleted ${DELETE_AFTER_DAYS} days later unless you add a month.`;

/** The account's plan, above the Settings tabs. Reserves its height while loading so "Free" never flashes. */
export function PlanCard() {
    const result = usePlan();
    const plan = result?.plan;
    return (
        <div
            data-testid="plan-card"
            className="mb-4 min-h-[5.5rem] rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]"
        >
            {!result ? null : !plan ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load your plan.</p>
                    <Button asChild variant="outline" size="sm"><Link href="/pricing">See pricing</Link></Button>
                </div>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold leading-snug">
                            {plan.status === "free"
                                ? `${PRIVACY_MODES.local.name} · ${PRIVACY_MODES.local.price}`
                                : `${PRIVACY_MODES.cloud.name} through ${formatPaidUntil(plan.until)}${plan.gift ? " — a gift; you weren't charged for this time." : ""}`}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">{plan.status === "free" ? FREE_LINE : FULL_LINE}</p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/pricing">{plan.status === "free" ? `See the paid month — ${PRO_MONTHLY_PRICE}` : "Add months"}</Link>
                    </Button>
                </div>
            )}
        </div>
    );
}
