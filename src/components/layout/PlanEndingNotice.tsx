"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "@phosphor-icons/react";
import { formatPaidUntil } from "@/app/pricing/offer";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/account/plan";

/** Keyed by the end date, so a later purchase (a new end) shows the notice again. */
export const planEndingDismissKey = (until: number) => `plan-ending-dismissed:${until}`;

function wasDismissed(until: number): boolean {
    try {
        return localStorage.getItem(planEndingDismissKey(until)) === "1";
    } catch {
        return false;
    }
}

/** Says, once per end date, that full access ends within a week. Mounted once, by TopBar, for every signed-in page. */
export function PlanEndingNotice() {
    const pathname = usePathname();
    const result = usePlan();
    const [dismissedUntil, setDismissedUntil] = useState<number | null>(null);
    const plan = result?.plan;
    if (pathname.startsWith("/pricing") || plan?.status !== "full" || !plan.endsSoon) return null;
    if (dismissedUntil === plan.until || wasDismissed(plan.until)) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(planEndingDismissKey(plan.until), "1");
        } catch {
            /* private mode: dismissed for this page view only */
        }
        setDismissedUntil(plan.until);
    };

    return (
        <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] z-[var(--z-toast)] flex flex-col items-end lg:inset-x-auto lg:bottom-4 lg:right-4">
            <div
                role="status"
                aria-live="polite"
                data-testid="plan-ending-notice"
                className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-none border border-live bg-background px-4 py-3 text-sm enter-reveal"
            >
                <div className="flex-1">
                    <p className="leading-snug text-foreground">
                        Your full access ends {formatPaidUntil(plan.until)}. Search stays free — add a month to keep résumé tailoring and saved copies.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-2">
                        <Link href="/pricing" prefetch={false}>Add months</Link>
                    </Button>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="designed-focus shrink-0 rounded-ctl text-muted-foreground transition-colors hover:text-foreground focus-visible:border-foreground"
                    aria-label="Dismiss"
                >
                    <X weight="bold" />
                </button>
            </div>
        </div>
    );
}
