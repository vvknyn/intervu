"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "@phosphor-icons/react";
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
import { BrandMark } from "@/components/brand/BrandMark";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useTheme } from "@/components/providers/ThemeProvider";
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
    const { mode, toggleMode, mounted } = useTheme();

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
            className="sticky top-0 z-50 shrink-0 border-b border-border/80 bg-background/80 backdrop-blur-md transition-colors"
        >
            <div className="relative mx-auto flex h-16 w-full max-w-[920px] items-center justify-between px-5 sm:px-7 xl:max-w-[1280px]">
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2 text-foreground transition-opacity hover:opacity-90"
                    data-testid="topbar-logo"
                >
                    <BrandMark className="h-7 w-7 text-foreground" />
                    <span className="font-display text-[20px] font-bold tracking-tight text-foreground">
                        intervu
                    </span>
                </Link>

                <div className="flex items-center gap-3 sm:gap-5">
                    {liveJobsLabel && (
                        <Link
                            href="/trends"
                            data-testid="topbar-pulse-ticker"
                            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/80 bg-emerald-50/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-800 shadow-2xs transition-all hover:bg-emerald-100 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300 lg:inline-flex"
                        >
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            {liveJobsLabel}
                        </Link>
                    )}
                    <nav
                        aria-label="Primary"
                        className="hidden items-center gap-1 text-[13px] font-medium lg:flex"
                    >
                        {NAV_TABS.map((tab) => {
                            const active = tab.match(pathname);
                            return (
                                <Link
                                    key={tab.href + tab.label}
                                    href={tab.href}
                                    data-testid={tab.testId}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "rounded-md px-3 py-1.5 transition-all duration-150",
                                        active
                                            ? "bg-slate-200/70 font-semibold text-foreground shadow-2xs dark:bg-slate-800"
                                            : "text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground",
                                    )}
                                >
                                    {tab.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {mounted ? (
                        <button
                            type="button"
                            onClick={toggleMode}
                            aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                    ) : (
                        <span aria-hidden className="block h-8 w-8 shrink-0" />
                    )}

                    {user ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    data-testid="topbar-avatar"
                                    title={user.displayName || user.email || "Account"}
                                    aria-current={accountActive ? "page" : undefined}
                                    className={cn(
                                        "grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-[12px] font-semibold text-white shadow-xs outline-none transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-slate-100 dark:text-slate-900",
                                        accountActive && "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background",
                                    )}
                                >
                                    {initialsOf(user)}
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
                                <DropdownMenuItem asChild className="rounded-lg">
                                    <Link href="/settings">Account</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild className="rounded-lg">
                                    <Link href="/pricing">Pricing</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild className="rounded-lg">
                                    <Link href="/research/ghost-jobs">Ghost Job Research</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <FeedbackModal>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="rounded-lg">
                                        Feedback
                                    </DropdownMenuItem>
                                </FeedbackModal>
                                <DropdownMenuItem asChild className="rounded-lg text-muted-foreground text-xs">
                                    <Link href="/privacy">Privacy & Terms</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={handleSignOut} className="rounded-lg text-rose-600 dark:text-rose-400">
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <button
                            data-testid="topbar-login"
                            onClick={() => setAuthPopoverOpen(true)}
                            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-2xs transition-all hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
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
