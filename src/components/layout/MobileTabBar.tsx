"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_ACCOUNT_TAB, NAV_TABS } from "@/components/layout/nav-tabs";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useNavBadgeCounts } from "@/components/layout/use-nav-badges";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [...NAV_TABS, MOBILE_ACCOUNT_TAB];

export function MobileTabBar() {
    const pathname = usePathname();
    // Above the early return: hooks must run in the same order on every render,
    // and `hideNav` is route-dependent.
    const navBadges = useNavBadgeCounts();
    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length}, minmax(0, 1fr))` }}
            className="fixed inset-x-0 bottom-0 z-50 grid border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
        >
            {MOBILE_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href + tab.label}
                        href={tab.href}
                        // Prefixed so a testid is unique page-wide: this bar
                        // shares NAV_TABS with the desktop TopBar and both are
                        // in the DOM at once (this one CSS-hidden at lg+) —
                        // bare tab.testId made every strict testid locator
                        // resolve to 2 elements.
                        data-testid={`mobile-${tab.testId}`}
                        data-tour={tab.tourSelector}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "relative flex h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-xs font-semibold transition-colors duration-100 [&_svg]:h-[22px] [&_svg]:w-[22px]",
                            active ? "font-semibold text-brand" : "text-muted-foreground",
                        )}
                    >
                        {active && (
                            <span
                                aria-hidden
                                className="absolute inset-x-0 top-0 mx-auto h-0.5 w-7 rounded-b-sm bg-brand"
                            />
                        )}
                        {Icon && (
                            <span className="relative flex items-center justify-center">
                                <Icon />
                                {/* Count over the icon — the standard tab-bar badge
                                    position, and the same `NavTab.badge` declaration
                                    the desktop bar reads, so the two can't disagree
                                    about which tab carries a number. */}
                                {tab.badge && navBadges[tab.badge] > 0 && (
                                    <span
                                        data-testid={`mobile-${tab.testId}-badge`}
                                        className="absolute -right-2.5 -top-1 mono-data rounded-none bg-brand px-1 text-xs font-semibold text-brand-foreground"
                                    >
                                        {navBadges[tab.badge]}
                                    </span>
                                )}
                            </span>
                        )}
                        <span>{tab.shortLabel}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
