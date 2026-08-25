"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FunnelSimple, MagnifyingGlass, MapPin, Moon, Sun, CaretDown } from "@phosphor-icons/react";
import { onAuthChange, refreshSession, signOut, type User } from "@/lib/firebase/client-auth";
import { useSearchDock } from "@/components/layout/SearchDockContext";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CreditBalance } from "@/components/layout/CreditBalance";
import { FollowAlertsBell } from "@/components/follows/FollowAlertsBell";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { chipVariants, ChipDismiss } from "@/components/ui/chip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_TABS, menuNavActive, menuNavTriggerLabel } from "@/components/layout/nav-tabs";
import { useNavBadgeCounts } from "@/components/layout/use-nav-badges";
import { BrandMark } from "@/components/brand/BrandMark";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/utils";
import { GHOST_JOB_RESEARCH_TITLE } from "@/lib/seo/ghost-job-term";
import { useShareControl } from "@/components/ui/share-action";
import { withShareRef } from "@/lib/share/share-decision";
import { getSiteUrl, SHARE_APP_TEXT, SITE_NAME } from "@/lib/seo/constants";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";

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
    const menuTabs = NAV_TABS.filter((t) => t.placement === "menu");
    const barTabs = NAV_TABS.filter((t) => t.placement === "bar");
    const menuActive = menuNavActive(pathname, NAV_TABS);
    const menuTriggerLabel = menuNavTriggerLabel(pathname, NAV_TABS);

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
                    className="flex shrink-0 items-center gap-2 text-brand transition-opacity hover:opacity-90"
                    data-testid="topbar-logo"
                >
                    <BrandMark className="h-7 w-7 text-brand" />
                    <span className="font-display text-[20px] font-black uppercase tracking-tight text-brand">
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
                        real field instead of inventing a header-only look.
                        `overflow-visible` is load-bearing: query and location
                        typeahead are absolutely positioned below the inputs,
                        and overflow-hidden clipped them into a 40px slit. */}
                    {docked && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                docked.onSubmit(docked.value);
                            }}
                            data-testid="topbar-docked-search"
                            data-tour="jobs-search"
                            className="hidden h-10 min-w-0 flex-1 box-border items-stretch overflow-visible rounded-none border border-border bg-card text-left transition-colors focus-within:border-foreground hover:border-foreground lg:flex"
                        >
                            <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 pl-3">
                                <MagnifyingGlass size={15} weight="bold" className="shrink-0 self-center text-foreground" />
                                <div
                                    data-testid="topbar-docked-query"
                                    className="relative flex h-full min-w-0 flex-1 items-stretch overflow-visible"
                                />
                            </div>
                            <div className="flex h-full w-[min(210px,28%)] shrink-0 items-stretch border-l border-border pr-1">
                                <MapPin size={15} weight="bold" aria-hidden className="ml-2.5 shrink-0 self-center text-muted-foreground/70" />
                                <div data-testid="topbar-docked-location" className="relative flex h-full min-w-0 flex-1 items-stretch overflow-visible" />
                            </div>
                            <button
                                type="submit"
                                className="box-border flex h-full min-h-0 shrink-0 items-center justify-center whitespace-nowrap bg-brand px-4 py-0 text-xs font-bold uppercase leading-none tracking-wider text-brand-foreground transition-colors hover:bg-brand/90"
                            >
                                Search
                            </button>
                        </form>
                    )}
                    <div className="flex shrink-0 items-center gap-3">
                    <nav
                        aria-label="Primary"
                        className="hidden items-center gap-3 text-[13px] font-medium lg:flex"
                    >
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                className={cn(
                                    "inline-flex items-center gap-1 whitespace-nowrap rounded-none px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors outline-none",
                                    menuActive
                                        ? "border-b-2 border-brand text-brand font-bold"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {menuTriggerLabel}
                                <CaretDown size={12} weight="bold" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-[9rem] rounded-none border border-border bg-card p-1">
                                {menuTabs.map((tab) => {
                                    const active = tab.match(pathname);
                                    return (
                                        <DropdownMenuItem key={tab.href + tab.label} asChild className="rounded-none">
                                            <Link
                                                href={tab.href}
                                                data-testid={tab.testId}
                                                aria-current={active ? "page" : undefined}
                                                className={cn(
                                                    "flex w-full items-center whitespace-nowrap text-xs font-semibold uppercase tracking-wider",
                                                    active && "text-brand",
                                                )}
                                            >
                                                {tab.label}
                                                {tab.badge && navBadges[tab.badge] > 0 && (
                                                    <span
                                                        data-testid={`${tab.testId}-badge`}
                                                        className="ml-auto mono-data text-xs font-bold text-brand"
                                                    >
                                                        {navBadges[tab.badge]}
                                                    </span>
                                                )}
                                            </Link>
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {barTabs.map((tab) => {
                            const active = tab.match(pathname);
                            return (
                                <Link
                                    key={tab.href + tab.label}
                                    href={tab.href}
                                    data-testid={tab.testId}
                                    data-tour={tab.tourSelector}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "whitespace-nowrap rounded-none px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
                                        active
                                            ? "border-b-2 border-brand text-brand font-bold"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {tab.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <FollowAlertsBell />

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
                                {mounted && (
                                    <DropdownMenuItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            toggleMode();
                                        }}
                                        className="rounded-lg"
                                    >
                                        <span className="flex w-full items-center gap-2">
                                            {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                                            <span>Dark mode</span>
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {mode === "dark" ? "On" : "Off"}
                                            </span>
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={handleSignOut} className="rounded-lg text-rose-600 dark:text-rose-400">
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        </>
                    ) : (
                        <button
                            type="button"
                            data-testid="topbar-alerts-cta"
                            onClick={() => {
                                setAuthTab("signup");
                                setAuthPopoverOpen(true);
                            }}
                            className="hidden h-10 box-border items-center justify-center whitespace-nowrap rounded-none bg-brand px-3.5 text-xs font-bold uppercase tracking-wider text-brand-foreground transition-colors hover:bg-brand/90 lg:inline-flex"
                        >
                            Get job alerts
                        </button>
                    )}
                    </div>
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
                    <div className="shell-row flex min-h-9 flex-nowrap items-center gap-1.5 overflow-x-auto py-1">
                        <div data-testid="topbar-docked-field-directory" className="flex shrink-0 items-center gap-2" />
                        <button
                            type="button"
                            onClick={docked.onOpenFilters}
                            aria-expanded={docked.filtersExpanded}
                            aria-controls="filters-panel"
                            data-testid="topbar-docked-filters-toggle"
                            className={cn(
                                chipVariants({ active: docked.filtersExpanded || docked.filterCount > 0 }),
                                toolbarControlHeight,
                                "box-border shrink-0 items-center justify-center gap-1.5 rounded-none px-3 text-xs font-semibold uppercase tracking-wider lg:px-2",
                                docked.filtersExpanded && "border-brand bg-brand text-brand-foreground",
                            )}
                        >
                            <FunnelSimple size={12} weight="bold" aria-hidden />
                            Filters
                            {docked.filterCount > 0 && (
                                <span className="ml-0.5 inline-flex min-w-[16px] items-center justify-center rounded-none border border-brand/40 bg-brand/10 px-1 text-xs font-bold leading-[14px] text-brand">
                                    {docked.filterCount}
                                </span>
                            )}
                        </button>
                        <div data-testid="topbar-docked-facets" className="flex shrink-0 items-center gap-1.5" />
                        {docked.chips.map((chip) => (
                            <span
                                key={chip.key}
                                data-testid="topbar-docked-chip"
                                className={cn(
                                    chipVariants({ active: false }),
                                    toolbarControlHeight,
                                    "box-border items-center gap-1.5 px-3 lg:px-2",
                                )}
                            >
                                {chip.label}
                                <ChipDismiss label={`Clear ${chip.label}`} onClick={() => docked.onClearChip(chip.key)} />
                            </span>
                        ))}
                        <div data-testid="topbar-docked-clear-filters" className="flex shrink-0 items-center gap-1.5" />
                        <div data-testid="topbar-docked-save-search" className="flex shrink-0 items-center gap-1.5" />
                        <div className="min-w-0 flex-1" aria-hidden />
                        <div data-testid="topbar-docked-resume" className="flex shrink-0 items-center gap-2" />
                        <div data-testid="topbar-docked-sort" className="flex shrink-0 items-center gap-2" />
                        <div data-testid="topbar-docked-extras" className="flex shrink-0 items-center gap-2" />
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
