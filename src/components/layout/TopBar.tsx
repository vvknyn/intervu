"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrefetchOnIntent } from "@/components/layout/use-prefetch-on-intent";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { onAuthChange, signOut, type User } from "@/lib/firebase/client-auth";
import { resolveAuthChrome } from "@/lib/auth/chrome-state";
import { useSearchDock } from "@/components/layout/SearchDockContext";
import { AuthPopover } from "@/components/auth/auth-popover";
import { FollowAlertsBell } from "@/components/follows/FollowAlertsBell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { CountBadge, SolidBadge } from "@/components/ui/badge";
import { chipVariants, ChipDismiss } from "@/components/ui/chip";
import { TabItem, TabNav } from "@/components/ui/tabs";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { useConnectTabLabel } from "@/components/layout/use-connect-tab-label";
import { useNavBadgeCounts } from "@/components/layout/use-nav-badges";
import { BrandLockup } from "@/components/brand/BrandMark";
import { isLeanProductSurface, shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { cn, CHROME_FOCUS_VISIBLE } from "@/lib/utils";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";

/**
 * Frozen coherent chrome:
 * - Mobile (< lg): centered mark + wordmark, auth affordance pinned right — nav lives in MobileTabBar
 * - Desktop (lg+): logo left · Jobs · Tracker · Connect · DP rightmost
 */
export function TopBar() {
    const pathname = usePathname();
    const prefetchOnIntent = usePrefetchOnIntent();
    const leanSurface = isLeanProductSurface(pathname);
    // `undefined` until `onAuthChange` resolves — NOT `null`, which would
    // claim "signed out" during the server round-trip and flash a Sign-in
    // button at a signed-in user. See lib/auth/chrome-state.ts.
    const [user, setUser] = useState<User | null | undefined>(undefined);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [authTab, setAuthTab] = useState<"login" | "signup">("login");
    const [signingOut, setSigningOut] = useState(false);
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
    const { docked } = useSearchDock();
    const navBadges = useNavBadgeCounts();
    // The header's ONE nav: every product destination as an underline tab.
    const navTabs = NAV_TABS.filter((t) => {
        // Signed out there is no product nav (sign-in / create-account instead).
        if (!user) return false;
        if (t.href === "/connect") {
            // Lean jobs/apply surfaces: drop the desktop header MCP link (/connect).
            // Signed-out public chrome (404, marketing-adjacent routes): no MCP tab.
            return !leanSurface && authChrome === "authenticated";
        }
        return true;
    });
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
            <div
                data-region="header"
                className="shell-row relative flex h-[var(--topbar-h)] items-center justify-between gap-6"
            >
                <Link
                    href="/"
                    prefetch={false}
                    {...prefetchOnIntent("/")}
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
                            className="ctl-md hidden min-w-0 flex-1 box-border items-stretch overflow-visible rounded-pill border border-border bg-card text-left transition-colors focus-within:border-foreground hover:border-foreground lg:flex"
                        >
                            <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 pl-3">
                                <MagnifyingGlass className="shrink-0 self-center text-foreground" />
                                <div
                                    data-testid="topbar-docked-query"
                                    className="relative flex h-full min-w-0 flex-1 items-stretch overflow-visible"
                                />
                            </div>
                            {/* Ghost, not filled — brand navy is reserved for
                                Sign in, the page's own Search CTA, and Upload
                                resume; this docked stand-in isn't one of the
                                three. */}
                            <button
                                type="submit"
                                data-testid="search-submit"
                                className="ctl-button box-border flex shrink-0 items-center justify-center whitespace-nowrap px-4 leading-none text-foreground transition-colors hover:bg-muted"
                            >
                                Search
                            </button>
                        </form>
                    )}
                    <div className="flex shrink-0 items-center gap-3">
                    <TabNav aria-label="Primary" className="hidden lg:flex">
                        {navTabs.map((tab) => {
                            const active = tab.match(pathname);
                            const count = tab.badge ? navBadges[tab.badge] : 0;
                            return (
                                <TabItem key={tab.href + tab.label} asChild size="bar" current={active ? "page" : false}>
                                    <Link
                                        href={tab.href}
                                        prefetch={false}
                                        {...prefetchOnIntent(tab.href)}
                                        title={tab.title}
                                        data-testid={tab.testId}
                                        data-tour={tab.tourSelector}
                                        data-nav-current={active ? "true" : undefined}
                                    >
                                        {tab.href === "/connect" ? "MCP" : tab.label}
                                        {count > 0 && <CountBadge count={count} data-testid={`${tab.testId}-badge`} />}
                                    </Link>
                                </TabItem>
                            );
                        })}
                    </TabNav>

                    <FollowAlertsBell />

                    {authChrome === "pending" ? (
                        /* Auth unresolved: reserve the row height so the bar
                           does not jump when it resolves, and assert nothing
                           about who is signed in. */
                        <span aria-hidden data-testid="topbar-auth-pending" className="ctl-md ctl-square block shrink-0" />
                    ) : authChrome === "authenticated" && user ? (
                        <AccountMenu
                            user={user}
                            active={accountActive}
                            signingOut={signingOut}
                            onSignOut={handleSignOut}
                        />
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                data-testid="topbar-signin"
                                onClick={() => {
                                    setAuthTab("login");
                                    setAuthPopoverOpen(true);
                                }}
                                className={cn("text-muted-foreground", CHROME_FOCUS_VISIBLE)}
                            >
                                {AUTH_CTA_LABEL}
                            </Button>
                            <Button
                                type="button"
                                data-testid="topbar-create-account"
                                onClick={() => {
                                    setAuthTab("signup");
                                    setAuthPopoverOpen(true);
                                }}
                                className={CHROME_FOCUS_VISIBLE}
                            >
                                {/* signup-gate-exempt: header entry point (gate id header), not an in-content gate */}Create account
                            </Button>
                        </>
                    )}
                    </div>
                </div>
            </div>

            {/* Second row — active filters only. */}
            {docked && (
                <div data-region="band" className="hidden bg-muted lg:block">
                    {/* Wrap instead of horizontal scroll; chips never truncate. */}
                    <div className="shell-row box-border flex w-full min-w-0 max-w-full min-h-[var(--jobs-filter-row-h)] flex-wrap items-center gap-2 overflow-x-clip border-t border-border">
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
                                        "ctl-button box-border shrink-0 items-center justify-center gap-2 px-3 lg:px-3",
                                    )}
                                >
                                    Filters
                                    {docked.filterCount > 0 && (
                                        <SolidBadge tone="muted" className="ml-0.5">
                                            {docked.filterCount}
                                        </SolidBadge>
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
                                                        "box-border shrink-0 items-center gap-2 whitespace-nowrap px-3 lg:px-3",
                                                    )}
                                                >
                                                    <span>{chip.label}</span>
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
