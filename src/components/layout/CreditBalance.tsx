"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Sparkle, Key } from "@phosphor-icons/react";
import { getMyCreditsAction } from "@/actions/credits";
import { cn } from "@/lib/utils";

type CreditState = { isAdmin: boolean; isBYOK: boolean; credits: number; monthlyFree: number };

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

    // icon + short label + optional tone, per account kind.
    let Icon = Coins;
    let label = `${s.credits} credit${s.credits === 1 ? "" : "s"}`;
    let title = `${s.credits} of ${s.monthlyFree} free AI credits left this month. Add your own API key in Settings to go unlimited.`;
    let low = !s.isAdmin && !s.isBYOK && s.credits <= 2;

    if (s.isAdmin) {
        Icon = Sparkle;
        label = "Unlimited";
        title = "Admin — unlimited AI use.";
        low = false;
    } else if (s.isBYOK) {
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
