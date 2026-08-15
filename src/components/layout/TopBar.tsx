"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMarketingStatsAction } from "@/actions/marketing";
import { onAuthChange, refreshSession, signOut, type User } from "@/lib/firebase/client-auth";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import { SecureStorage } from "@/lib/security";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CreditBalance } from "@/components/layout/CreditBalance";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { siteChrome } from "@/components/layout/site-chrome";
import { BrandMark } from "@/components/brand/BrandMark";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { cn } from "@/lib/utils";

function initialsOf(user: User): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 1).toUpperCase();
}

/**
 * Frozen coherent chrome:
 * - Mobile (< lg): centered mark + wordmark, auth affordance pinned right — nav lives in MobileTabBar
 * - Desktop (lg+): logo left · Jobs · Tracker · Connect · DP rightmost
 */
export function TopBar() {
    const pathname = usePathname();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const sessionRefreshed = useRef(false);

    useEffect(() => {
        const unsubscribe = onAuthChange((u) => {
            setUser(u);
            if (u && !sessionRefreshed.current) {
                sessionRefreshed.current = true;
                refreshSession().catch(() => {});
            }
        });
        return () => unsubscribe();
    }, []);

    // Desktop-only "N live roles" ticker linking to /trends (Vivek: "like the
    // old subspace product header"). Same fetch-once-on-mount + cancelled-flag
    // idiom as jobs/page.tsx's `marketClaim`, and the SAME 900s-cached action
    // that backs it — never an uncached call per TopBar mount. Stays `null`
    // (ticker absent, not a skeleton or a "0") until a real count resolves, on
    // both the loading and the failure path — never implies a stale/live count
    // it doesn't have.
    const [liveJobsLabel, setLiveJobsLabel] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        getMarketingStatsAction()
            .then((stats) => {
                if (!cancelled && stats) setLiveJobsLabel(`${formatCorpusCount(stats.liveJobs)} live roles`);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    const handleSignOut = async () => {
        SecureStorage.clear();
        await signOut();
        window.location.href = "/";
    };

    const accountActive =
        pathname.startsWith("/settings") || pathname.startsWith("/account");

    return (
        <header
            data-testid="topbar"
            className={cn("shrink-0 border-b", siteChrome.bar, siteChrome.border)}
        >
            <div className="relative mx-auto flex h-16 w-full max-w-[920px] items-center justify-center px-5 lg:justify-between sm:px-7">
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2.5 text-chrome-foreground"
                    data-testid="topbar-logo"
                >
                    <BrandMark className="h-12 w-12" />
                    <span className="text-[24px] font-semibold tracking-[-0.03em]">
                        intervu
                    </span>
                </Link>

                <div className="absolute right-5 flex items-center gap-[18px] sm:right-7 lg:static">
                    {liveJobsLabel && (
                        <Link
                            href="/trends"
                            data-testid="topbar-pulse-ticker"
                            className={cn("hidden shrink-0 font-mono text-[12px] lg:inline-flex", siteChrome.mutedHover)}
                        >
                            {liveJobsLabel}
                        </Link>
                    )}
                    <nav
                        aria-label="Primary"
                        className="hidden items-center gap-[18px] text-[13px] lg:flex"
                    >
                        {NAV_TABS.map((tab) => {
                            const active = tab.match(pathname);
                            return (
                                <Link
                                    key={tab.href + tab.label}
                                    href={tab.href}
                                    data-testid={tab.testId}
                                    aria-current={active ? "page" : undefined}
                                    className={active ? siteChrome.active : siteChrome.mutedHover}
                                >
                                    {tab.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {user ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    data-testid="topbar-avatar"
                                    title={user.displayName || user.email || "Account"}
                                    aria-current={accountActive ? "page" : undefined}
                                    className={cn(
                                        "ml-1 grid h-[32px] w-[32px] place-items-center rounded-full bg-foreground text-[12px] font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-foreground/30",
                                        accountActive && "ring-2 ring-background ring-offset-2 ring-offset-foreground",
                                    )}
                                >
                                    {initialsOf(user)}
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <div className="px-2 py-1.5">
                                    <CreditBalance />
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                    <Link href="/settings">Account</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <FeedbackModal>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                        Feedback
                                    </DropdownMenuItem>
                                </FeedbackModal>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={handleSignOut}>
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <button
                            data-testid="topbar-login"
                            onClick={() => setAuthPopoverOpen(true)}
                            className={cn("ml-1 text-[13px]", siteChrome.mutedHover)}
                        >
                            Sign in
                        </button>
                    )}
                </div>
            </div>

            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
        </header>
    );
}
