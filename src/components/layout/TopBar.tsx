"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MagnifyingGlass, MapPin, CaretDown } from "@phosphor-icons/react";
import { onAuthChange, signOut, type User } from "@/lib/firebase/client-auth";
import { resolveAuthChrome } from "@/lib/auth/chrome-state";
import { useSearchDock } from "@/components/layout/SearchDockContext";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowAlertsBell } from "@/components/follows/FollowAlertsBell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { chipVariants, ChipDismiss, filterCountBadgeClass } from "@/components/ui/chip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_TABS, menuNavActive, menuNavTriggerLabel } from "@/components/layout/nav-tabs";
import { useConnectTabLabel } from "@/components/layout/use-connect-tab-label";
import { useNavBadgeCounts } from "@/components/layout/use-nav-badges";
import { BrandLockup } from "@/components/brand/BrandMark";
import { isLeanProductSurface, shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/utils";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";

/**
 * Frozen coherent chrome:
 * - Mobile (< lg): centered mark + wordmark, auth affordance pinned right — nav lives in MobileTabBar
 * - Desktop (lg+): logo left · Jobs · Tracker · Connect · DP rightmost
 */
export function TopBar() {
    const pathname = usePathname();
    const leanSurface = isLeanProductSurface(pathname);
    // `undefined` until `onAuthChange` resolves — NOT `null`, which would
    // claim "signed out" during the server round-trip and flash a Sign-in
    // button at a signed-in user. See lib/auth/chrome-state.ts.
    const [user, setUser] = useState<User | null | undefined>(undefined);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [authTab, setAuthTab] = useState<"login" | "signup">("login");
    const [signingOut, setSigningOut] = useState(false);
    const { mode, toggleMode, mounted } = useTheme();

    useEffect(() => {
        const unsubscribe = onAuthChange((u) => setUser(u));
        return () => unsubscribe();
    }, []);

    // The "N live roles" ticker used to live here and fetched its own copy of
    // the marketing stats on every TopBar mount. It moved to sit directly above
    // the /jobs search box (2026-08-24, Vivek) where the count is doing work
    // rather than decorating a corner — it keeps its /trends link there, and
    // that page already had the same stats in hand, so this also removes a
    // duplicate fetch. This slot now belongs to the docked search below.
    const authChrome = resolveAuthChrome(user);
    const { docked, homeViewDocked } = useSearchDock();
    const navBadges = useNavBadgeCounts();
    const menuTabs = NAV_TABS.filter((t) => t.placement === "menu");
    const barTabs = NAV_TABS.filter((t) => t.placement === "bar").filter(
        // Lean hub/deck/apply: drop desktop header MCP (/connect). Pack-deck
        // `for-you-mcp-handoff` stays — that is not TopBar chrome.
        (t) => !(leanSurface && t.href === "/connect"),
    );
    const menuActive = menuNavActive(pathname, NAV_TABS);
    const menuTriggerLabel = menuNavTriggerLabel(pathname, NAV_TABS);
    const connectLabel = useConnectTabLabel(user?.uid ?? null, user !== undefined);

    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    const handleSignOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            localStorage.clear();
        } catch {
            /* private mode */
        }
        await signOut();
    };

    const accountActive =
        pathname.startsWith("/settings") || pathname.startsWith("/account");

    return (
        <header
            data-testid="topbar"
            className="sticky top-0 z-[var(--z-topbar)] shrink-0 border-b border-border bg-card pt-[env(safe-area-inset-top,0px)] transition-colors shadow-[var(--shadow-bevel-highlight)]"
        >
            {/* `shell-row` (globals.css) owns the width and the gutter, so this
                bar lines up with whatever the page below it is doing — capped
                on most pages, edge to edge on one that declares it. Writing a
                `max-w-*` here again would reintroduce the crooked frame.
                `data-region="header"` sits here (the top row) rather than on
                the outer `<header>` — the docked filter band below is a DOM
                child of that same `<header>` (for one sticky positioning
                context), so tagging the outer element would nest the band
                region inside the header region and double-count everything
                in it, plus fold the band's own height into "header height". */}
            <div data-region="header" className="shell-row relative flex h-[var(--topbar-h)] items-center justify-between gap-6">
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-90"
                    data-testid="topbar-logo"
                    data-rulebook-exempt
                >
                    <BrandLockup markClassName="h-8 w-8" />
                </Link>

                {/* `flex-1` so the row's leftover width lands HERE rather than
                    as a gap in the middle of the bar. `justify-end` keeps the
                    nav and the account controls against the right edge exactly
                    as before when nothing is docked; the only thing that can
                    grow is the docked search below. */}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:gap-6">
                    {/* The docked search. Shows what you searched for and puts
                        it back one click away.

                        It takes the WHOLE empty span of the bar (`flex-1`) and
                        wears the real field's own chrome — a `bg-card` pill
                        with a `border-border` outline — with a plain-text
                        "Search" trailing edge, not a filled block: brand navy
                        stays reserved for the page's own primary Search CTA,
                        not this docked stand-in.
                        Sized in the header's own token so it can't drift from
                        the bar. As a 380px pill
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
                            className="hidden h-8 min-w-0 flex-1 box-border items-stretch overflow-visible rounded-pill border border-border bg-card text-left transition-colors focus-within:border-foreground hover:border-foreground lg:flex"
                        >
                            <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 pl-3">
                                <MagnifyingGlass className="shrink-0 self-center text-foreground" />
                                <div
                                    data-testid="topbar-docked-query"
                                    className="relative flex h-full min-w-0 flex-1 items-stretch overflow-visible"
                                />
                            </div>
                            <div className="flex h-full w-[min(210px,28%)] shrink-0 items-stretch border-l border-border pr-1">
                                <MapPin aria-hidden className="ml-3 shrink-0 self-center text-muted-foreground" />
                                <div data-testid="topbar-docked-location" className="relative flex h-full min-w-0 flex-1 items-stretch overflow-visible" />
                            </div>
                            {/* Ghost, not filled — brand navy is reserved for
                                Sign in, the page's own Search CTA, and Upload
                                resume; this docked stand-in isn't one of the
                                three. */}
                            <button
                                type="submit"
                                className="box-border flex h-full min-h-0 shrink-0 items-center justify-center whitespace-nowrap px-4 py-0 text-sm font-semibold leading-none text-foreground transition-colors hover:bg-muted"
                            >
                                Search
                            </button>
                        </form>
                    )}
                    <div className="flex shrink-0 items-center gap-3">
                    <nav
                        aria-label="Primary"
                        className="hidden items-center gap-3 text-xs lg:flex"
                    >
                        {user && (
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    className={cn(
                                        "inline-flex items-center gap-1 whitespace-nowrap rounded-ctl px-3 py-1 text-sm transition-colors outline-none",
                                        menuActive
                                            ? "font-semibold text-foreground"
                                            : "font-normal text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    <span className={cn(menuActive && "border-b-2 border-brand")}>{menuTriggerLabel}</span>
                                    <CaretDown aria-hidden />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="min-w-[9rem] rounded-panel border-border bg-card">
                                    {menuTabs.map((tab) => {
                                        const active = tab.match(pathname);
                                        return (
                                            <DropdownMenuItem key={tab.href + tab.label} asChild>
                                                <Link
                                                    href={tab.href}
                                                    data-testid={tab.testId}
                                                    aria-current={active ? "page" : undefined}
                                                    className={cn(
                                                        "flex w-full items-center whitespace-nowrap",
                                                        active && "font-semibold text-foreground",
                                                    )}
                                                >
                                                    {tab.label}
                                                    {tab.badge && navBadges[tab.badge] > 0 && (
                                                        <span
                                                            data-testid={`${tab.testId}-badge`}
                                                            className="ml-auto mono-data text-xs font-semibold text-brand"
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
                        )}
                        {barTabs.map((tab) => {
                            const active = tab.match(pathname);
                            const label = tab.href === "/connect" ? "MCP" : tab.label;
                            return (
                                <Link
                                    key={tab.href + tab.label}
                                    href={tab.href}
                                    title={tab.title}
                                    data-testid={tab.testId}
                                    data-tour={tab.tourSelector}
                                    aria-current={active ? "page" : undefined}
                                    data-nav-current={active ? "true" : undefined}
                                    className={cn(
                                        "whitespace-nowrap rounded-ctl px-3 py-1 text-sm transition-colors",
                                        active
                                            ? "font-semibold text-foreground"
                                            : "font-normal text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    <span className={cn(active && "border-b-2 border-brand")}>{label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <FollowAlertsBell />

                    {authChrome === "pending" ? (
                        /* Auth unresolved: reserve the row height so the bar
                           does not jump when it resolves, and assert nothing
                           about who is signed in. */
                        <span aria-hidden data-testid="topbar-auth-pending" className="block h-10 w-8 shrink-0" />
                    ) : authChrome === "authenticated" && user ? (
                        <AccountMenu
                            user={user}
                            active={accountActive}
                            signingOut={signingOut}
                            onSignOut={handleSignOut}
                            mode={mode}
                            mounted={mounted}
                            toggleMode={toggleMode}
                        />
                    ) : (
                        <>
                        {/* Same AuthPopover as the alerts CTA below, opened on
                            its login tab — one auth system, two tabs. This is
                            deliberately NOT a second auth component: the branch
                            it sits in has already resolved that nobody is
                            signed in, so anything re-deciding that here could
                            only contradict it. Visible at every width — on
                            mobile it is the "auth affordance pinned right" the
                            component contract above promises, since the alerts
                            CTA is desktop-only. */}
                        {/* The one filled brand control in the header (ACCENT
                            DISCIPLINE) — reuses the shared Button's `default`
                            variant rather than a one-off filled treatment. */}
                        <Button
                            type="button"
                            data-testid="topbar-signin"
                            onClick={() => {
                                setAuthTab("login");
                                setAuthPopoverOpen(true);
                            }}
                            className="rounded-ctl"
                        >
                            {AUTH_CTA_LABEL}
                        </Button>
                        {/* Plain nav link, not a control — Sign in is the
                            header's one filled action. Kept hidden to declutter header. */}
                        <button
                            type="button"
                            data-testid="topbar-alerts-cta"
                            onClick={() => {
                                setAuthTab("signup");
                                setAuthPopoverOpen(true);
                            }}
                            className="hidden"
                        >
                            Get job alerts
                        </button>
                        </>
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
                yet) still renders the row for the "Filters" button alone.
                The row itself also stays up for `homeViewDocked` alone —
                the For-you/Search toggle needs this same fixed slot on
                desktop even when there's no active search to dock (the
                whole For-you view, or Search before a query is typed), so
                the toggle never jumps between an inline and a docked
                position depending on which of those it is. Everything below
                that reads `docked.*` stays gated on `docked` itself, since
                those fields don't exist when only the toggle is docked. */}
            {(docked || homeViewDocked) && (
                <div data-region="band" className="hidden bg-muted lg:block">
                    {/* Wrap instead of horizontal scroll — long query chips truncate
                        with a title tooltip; short facet/location chips stay whole. */}
                    <div className="shell-row box-border flex w-full min-w-0 max-w-full min-h-[var(--jobs-filter-row-h)] flex-wrap items-center gap-2 overflow-x-clip border-t border-border">
                        <div data-testid="topbar-docked-home-view" className="flex shrink-0 items-center gap-2" />
                        {docked && (
                            <>
                                <button
                                    type="button"
                                    onClick={docked.onOpenFilters}
                                    aria-expanded={docked.filtersExpanded}
                                    aria-controls="filters-panel"
                                    data-testid="topbar-docked-filters-toggle"
                                    className={cn(
                                        chipVariants({ active: docked.filtersExpanded, interactive: true }),
                                        toolbarControlHeight,
                                        "box-border shrink-0 items-center justify-center gap-2 px-3 text-xs font-semibold lg:px-3",
                                    )}
                                >
                                    Filters
                                    {docked.filterCount > 0 && (
                                        <span className={cn("ml-0.5", filterCountBadgeClass)}>
                                            {docked.filterCount}
                                        </span>
                                    )}
                                </button>
                                <div data-testid="topbar-docked-field-directory" className="flex shrink-0 items-center gap-2" />
                                <div data-testid="topbar-docked-facets" className="flex shrink-0 items-center gap-2" />
                                {docked.chips.length > 0 && (
                                    <>
                                        <span aria-hidden className="jobs-instrument-rule" />
                                        <div data-testid="topbar-docked-active-filters" className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                                            {docked.chips.map((chip) => (
                                                <span
                                                    key={chip.key}
                                                    data-testid="topbar-docked-chip"
                                                    title={chip.label}
                                                    className={cn(
                                                        chipVariants({ active: true, interactive: true }),
                                                        toolbarControlHeight,
                                                        "box-border min-w-0 max-w-full items-center gap-2 px-3 lg:px-3",
                                                    )}
                                                >
                                                    <span className="min-w-0 max-w-[min(100%,18rem)] truncate">{chip.label}</span>
                                                    <ChipDismiss label={`Clear ${chip.label}`} onClick={() => docked.onClearChip(chip.key)} />
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                )}
                                <div data-testid="topbar-docked-clear-filters" className="flex shrink-0 items-center gap-2" />
                                <div className="min-w-0 flex-1" aria-hidden />
                                <div data-testid="topbar-docked-save-search" className="flex min-w-0 max-w-full flex-wrap items-center gap-2" />
                                <div data-testid="topbar-docked-sort" className="flex shrink-0 items-center gap-2" />
                                <div data-testid="topbar-docked-extras" className="flex shrink-0 items-center gap-2" />
                            </>
                        )}
                    </div>
                </div>
            )}

            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
                trigger="user"
                defaultTab={authTab}
            />
        </header>
    );
}
