"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Sparkle } from "@phosphor-icons/react";
import { getMyCreditsAction } from "@/actions/credits";
import { BETA_UNLIMITED_CREDITS, CREDIT_UNIT, creditCount } from "@/lib/llm/credit-copy";
import { cn } from "@/lib/utils";

type CreditState = { isAdmin: boolean; allowance: number; earned: number; total: number; monthlyFree: number };

/**
 * Sidebar AI-credit indicator. Reads the current user's credit state once on
 * mount. Renders nothing until loaded (and nothing for signed-out users, whom
 * AppShell already gates on). Links to /pricing, which is where the allowance
 * model is actually explained.
 */
export function CreditBalance({ collapsed }: { collapsed?: boolean }) {
    const [s, setS] = useState<CreditState | null>(null);

    useEffect(() => {
        let alive = true;
        getMyCreditsAction()
            .then((r) => alive && setS(r))
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    if (!s) return null;

    // icon + short label + optional tone, per account kind. The total is what
    // a spend actually draws against; the tooltip discloses the allowance/
    // earned split so a balance that doesn't reset on the 1st isn't a
    // surprise.
    let Icon = Coins;
    let label = creditCount(s.total);
    let title = `${s.allowance} of ${s.monthlyFree} free AI ${CREDIT_UNIT.many} left this month.`;
    if (s.earned > 0) {
        title += ` Plus ${creditCount(s.earned)} earned that never expire.`;
    }
    let low = !s.isAdmin && s.total <= 2;

    if (BETA_UNLIMITED_CREDITS) {
        // Nothing worth a slot in the top bar. The gate never draws on the
        // balance during beta, so the number would sit frozen and read as a
        // stuck counter, and a standing "Unlimited" badge oversells what is a
        // temporary condition.
        return null;
    } else if (s.isAdmin) {
        Icon = Sparkle;
        label = "Unlimited";
        title = "Admin — unlimited AI use.";
        low = false;
    }

    return (
        <Link
            href="/pricing"
            title={title}
            data-testid="topbar-credit-balance"
            className={cn(
                "flex items-center gap-2.5 p-2 rounded-[9px] text-[13px] transition-colors hover:bg-muted",
                collapsed && "justify-center",
                low ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
        >
            <Icon size={18} weight={low ? "fill" : "regular"} className="shrink-0" />
            {!collapsed && <span className="flex-1 truncate font-medium">{label}</span>}
            {!collapsed && low && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold">low</span>
            )}
        </Link>
    );
}
