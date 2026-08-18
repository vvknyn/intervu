"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Sparkle, Key } from "@phosphor-icons/react";
import { getMyCreditsAction } from "@/actions/credits";
import { cn } from "@/lib/utils";

type CreditState = { isAdmin: boolean; isBYOK: boolean; allowance: number; earned: number; total: number; monthlyFree: number };

/**
 * Sidebar AI-credit indicator. Reads the current user's credit state once on
 * mount. Renders nothing until loaded (and nothing for signed-out users, whom
 * AppShell already gates on). Links to Settings to add a key / top up.
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
    let label = `${s.total} credit${s.total === 1 ? "" : "s"}`;
    let title = `${s.allowance} of ${s.monthlyFree} free AI credits left this month.`;
    if (s.earned > 0) {
        title += ` Plus ${s.earned} earned credit${s.earned === 1 ? "" : "s"} that never expire.`;
    }
    let low = !s.isAdmin && !s.isBYOK && s.total <= 2;

    if (s.isAdmin) {
        Icon = Sparkle;
        label = "Unlimited";
        title = "Admin — unlimited AI use.";
        low = false;
    } else if (s.isBYOK) {
        // Legacy state: a key stored before the Settings entry point was
        // removed (2026-08-08). No UI offers adding a new one anymore.
        Icon = Key;
        label = "Your API key";
        title = "Using your own API key — no credit limit.";
        low = false;
    }

    return (
        <Link
            href="/settings"
            title={title}
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
