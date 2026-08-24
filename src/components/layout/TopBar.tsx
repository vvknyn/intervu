"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FunnelSimple, MagnifyingGlass, Moon, Sun } from "@phosphor-icons/react";
import { onAuthChange, refreshSession, signOut, type User } from "@/lib/firebase/client-auth";
import { useSearchDock } from "@/components/layout/SearchDockContext";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CreditBalance } from "@/components/layout/CreditBalance";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { chipVariants, ChipDismiss } from "@/components/ui/chip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { useNavBadgeCounts } from "@/components/layout/use-nav-badges";
import { BrandMark } from "@/components/brand/BrandMark";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/utils";
import { GHOST_JOB_RESEARCH_TITLE } from "@/lib/seo/ghost-job-term";
import { useShareControl } from "@/components/ui/share-action";
import { withShareRef } from "@/lib/share/share-decision";
import { getSiteUrl, SHARE_APP_TEXT, SITE_NAME } from "@/lib/seo/constants";

function initialsOf(user: User): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 1).toUpperCase();
}

/** "Share Intervu" account-menu entry — same share control as JobDetail's
 *  ShareAction (native sheet, clipboard fallback, honest failure), rendered
 *  as a plain DropdownMenuItem so it keeps this menu's own keyboard/click
 *  handling rather than nesting a second interactive element inside it.
 *  `onSelect` is prevented so the menu stays open long enough to show the
 *  transient "Copied"/"Couldn't share" text. */
function ShareIntervuMenuItem() {
    const { state, trigger } = useShareControl();
    const label = state === "copied" ? "Copied!" : state === "failed" ? "Couldn't share" : "Share Intervu";

    return (
        <DropdownMenuItem
            onSelect={(e) => {
                e.preventDefault();
                trigger({ title: SITE_NAME, text: SHARE_APP_TEXT, url: withShareRef(getSiteUrl(), "app") });
            }}
            className="rounded-lg"
        >
            {label}
        </DropdownMenuItem>
    );
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
    // Which tab the popover opens on — "Get job alerts" (primary, value-first
    // per the 2026-08-20 signup-ladder audit) opens straight to signup, where
    // LoginForm's own SIGNUP_SUBCOPY carries the alerts/tracker pitch; the
    // demoted "Log in" link keeps the old login-tab behavior.
    const [authTab, setAuthTab] = useState<"login" | "signup">("login");
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

    // The "N live roles" ticker used to live here and fetched its own copy of
    // the marketing stats on every TopBar mount. It moved to sit directly above
    // the /jobs search box (2026-08-24, Vivek) where the count is doing work
    // rather than decorating a corner — it keeps its /trends link there, and
    // that page already had the same stats in hand, so this also removes a
    // duplicate fetch. This slot now belongs to the docked search below.
    const { docked } = useSearchDock();
    const navBadges = useNavBadgeCounts();

    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    const handleSignOut = async () => {
        localStorage.clear();
        await signOut();
        window.location.href = "/";
    };

    const accountActive =
        pathname.startsWith("/settings") || pathname.startsWith("/account");

    return (
        <header
            data-testid="topbar"
            className="sticky top-0 z-50 shrink-0 border-b border-border/80 bg-background/75 backdrop-blur-2xl backdrop-saturate-180 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.05)] transition-colors"
        >
            {/* `shell-row` (globals.css) owns the width and the gutter, so this
                bar lines up with whatever the page below it is doing — capped
                on most pages, edge to edge on one that declares it. Writing a
                `max-w-*` here again would reintroduce the crooked frame. */}
            <div className="shell-row relative flex h-[var(--topbar-h)] items-center justify-between gap-6">
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2 text-foreground transition-opacity hover:opacity-90"
                    data-testid="topbar-logo"
                >
                    <BrandMark className="h-7 w-7 text-foreground" />
                    <span className="font-display text-[20px] font-black uppercase tracking-tight text-foreground">
                        intervu
                    </span>
                </Link>

                {/* `flex-1` so the row's leftover width lands HERE rather than
                    as a gap in the middle of the bar. `justify-end` keeps the
                    nav and the account controls against the right edge exactly
                    as before when nothing is docked; the only thing that can
                    grow is the docked search below. */}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:gap-5">
                    {/* The docked search. Shows what you searched for and puts
                        it back one click away.

                        It takes the WHOLE empty span of the bar (`flex-1`) and
                        wears the search field's own chrome — card ground,
                        `border-border` at rest, a full-height inverted SEARCH
                        block on the trailing edge. Sized in the header's own
                        token so it can't drift from the bar. As a 380px pill
                        with a small grey "Edit" it read as a status label, not
                        a control (Vivek, 2026-08-24: "it is not at all obvious
                        that this is a search bar"): width and field vocabulary
                        are what say "search box", so it borrows both from the
                        real field instead of inventing a header-only look. */}
                    {docked && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                docked.onSubmit(docked.value);
                            }}
                            data-testid="topbar-docked-search"
                            className="hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-none border border-border bg-card pl-3 text-left transition-colors focus-within:border-foreground hover:border-foreground lg:flex"
                        >
                            <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-foreground" />
                            <input
                                type="text"
                                value={docked.value}
                                onChange={(e) => docked.onChange(e.target.value)}
                                placeholder={docked.placeholder}
                                aria-label="Search jobs"
                                data-testid="topbar-docked-search-input"
                                className="min-w-0 flex-1 truncate border-0 bg-transparent text-xs font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
                            />
                            {/* The hero field carried its own "✕ clear query";
                                docking took that away and put nothing back, so
                                a search could be narrowed but never emptied
                                without selecting the text by hand. Clears and
                                re-runs in one step, which is what the hero
                                version did — not just blanking the draft. */}
                            {docked.value && (
                                <button
                                    type="button"
                                    aria-label="Clear query"
                                    title="Clear query"
                                    data-testid="topbar-docked-clear"
                                    onClick={() => {
                                        docked.onChange("");
                                        docked.onSubmit("");
                                    }}
                                    className="shrink-0 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    ✕
                                </button>
                            )}
                            {docked.place && (
                                <button
                                    type="button"
                                    onClick={docked.onPlaceClick}
                                    disabled={!docked.onPlaceClick}
                                    data-testid="topbar-docked-place"
                                    className="shrink truncate border-l border-border pl-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default"
                                >
                                    {docked.place}
                                </button>
                            )}
                            <button
                                type="submit"
                                className="ml-auto flex shrink-0 items-center self-stretch bg-foreground px-4 text-[10px] font-bold uppercase tracking-wider text-background"
                            >
                                Search
                            </button>
                        </form>
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
                                        "rounded-none px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
                                        active
                                            ? "border-b-2 border-foreground text-foreground font-bold"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {tab.label}
                                    {/* Declared by the tab, resolved by the shared
                                        badge hook — this bar never asks WHICH tab it
                                        is drawing. Zero is not rendered: an empty
                                        tracker should read as nothing to see, not as
                                        a count of none. */}
                                    {tab.badge && navBadges[tab.badge] > 0 && (
                                        <span
                                            data-testid={`${tab.testId}-badge`}
                                            className="ml-1.5 mono-data text-[11px] font-bold text-brand"
                                        >
                                            {navBadges[tab.badge]}
                                        </span>
                                    )}
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
                        <>
                            <CreditBalance />
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
                                    <Link href="/research/ghost-jobs">{GHOST_JOB_RESEARCH_TITLE}</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <FeedbackModal>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="rounded-lg">
                                        Feedback
                                    </DropdownMenuItem>
                                </FeedbackModal>
                                <ShareIntervuMenuItem />
                                <DropdownMenuItem asChild className="rounded-lg text-muted-foreground text-xs">
                                    <Link href="/privacy">Privacy & Terms</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={handleSignOut} className="rounded-lg text-rose-600 dark:text-rose-400">
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        </>
                    ) : (
                        <div className="hidden items-center gap-3 lg:flex">
                            {/* Primary, value-first CTA (audit, 2026-08-20): a signed-out
                                visitor's only prior ask was a bare "Log in". Inverted-ink
                                block — solid foreground fill, background text, squared
                                corners, no shadow — same treatment as the house system's
                                other primary actions (e.g. JobDetail's apply button). */}
                            <button
                                type="button"
                                data-testid="topbar-alerts-cta"
                                onClick={() => {
                                    setAuthTab("signup");
                                    setAuthPopoverOpen(true);
                                }}
                                className="rounded-none bg-foreground px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-wider text-background transition-colors hover:bg-foreground/90"
                            >
                                Get job alerts
                            </button>
                            <button
                                type="button"
                                data-testid="topbar-login"
                                onClick={() => {
                                    setAuthTab("login");
                                    setAuthPopoverOpen(true);
                                }}
                                className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                                Log in
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Second row — active filters, docked alongside the search above
                rather than left behind on the page it came from. Only the
                page that owns `docked` knows what a "filter" is; this row
                just renders whatever chips it was handed and a count badge,
                same narrow seam as the search field above. `lg:flex` matches
                the search row's own `lg:` gate — `docked` is only ever
                populated on desktop (see jobs/page.tsx), but the class keeps
                this row from ever appearing below that breakpoint even if
                that changes. Chip-less (a fresh search, nothing narrowed
                yet) still renders the row for the "Filters" button alone. */}
            {docked && (
                <div className="hidden border-t border-border/60 bg-background/60 lg:block">
                    <div className="shell-row flex min-h-9 flex-wrap items-center gap-2 py-1.5">
                        <button
                            type="button"
                            onClick={docked.onOpenFilters}
                            data-testid="topbar-docked-filters-toggle"
                            className={cn(
                                chipVariants({ active: docked.filterCount > 0 }),
                                "gap-1.5 font-semibold uppercase tracking-wider",
                            )}
                        >
                            <FunnelSimple size={12} weight="bold" aria-hidden />
                            Filters
                            {docked.filterCount > 0 && (
                                <span className="ml-0.5 inline-flex min-w-[16px] items-center justify-center rounded-none border border-brand/40 bg-brand/10 px-1 text-[10px] font-bold leading-[14px] text-brand">
                                    {docked.filterCount}
                                </span>
                            )}
                        </button>
                        {/* The page's standing context (on /jobs, the live-role
                            count). It sits on this row rather than in a band of
                            its own — a single line of text does not justify a
                            full-width surface, which is exactly the empty well
                            this row replaced. Rendered as a link only when the
                            page supplied somewhere to go. */}
                        {docked.status && (
                            docked.status.href ? (
                                <Link
                                    href={docked.status.href}
                                    data-testid="topbar-docked-status"
                                    className="mono-data inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand transition-colors hover:text-brand/80"
                                >
                                    <span aria-hidden className="h-1.5 w-1.5 rounded-none bg-brand animate-pulse" />
                                    {docked.status.label}
                                </Link>
                            ) : (
                                <span
                                    data-testid="topbar-docked-status"
                                    className="mono-data inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand"
                                >
                                    <span aria-hidden className="h-1.5 w-1.5 rounded-none bg-brand animate-pulse" />
                                    {docked.status.label}
                                </span>
                            )
                        )}
                        {docked.chips.map((chip) => (
                            <span
                                key={chip.key}
                                data-testid="topbar-docked-chip"
                                className={cn(chipVariants({ active: false }), "gap-1.5")}
                            >
                                {chip.label}
                                <ChipDismiss label={`Clear ${chip.label}`} onClick={() => docked.onClearChip(chip.key)} />
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
                defaultTab={authTab}
            />
        </header>
    );
}
