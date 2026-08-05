"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_ACCOUNT_TAB, NAV_TABS } from "@/components/layout/nav-tabs";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [...NAV_TABS, MOBILE_ACCOUNT_TAB];

export function MobileTabBar() {
    const pathname = usePathname();
    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length}, minmax(0, 1fr))` }}
            className="fixed inset-x-0 bottom-0 z-50 grid bg-background px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
        >
            {MOBILE_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href + tab.label}
                        href={tab.href}
                        data-testid={tab.testId}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors duration-100 [&_svg]:h-[22px] [&_svg]:w-[22px]",
                            active ? "text-foreground" : "text-faint",
                        )}
                    >
                        {active && (
                            <span
                                aria-hidden
                                className="absolute inset-x-0 top-0 mx-auto h-0.5 w-7 rounded-b-sm bg-foreground"
                            />
                        )}
                        {Icon && <Icon />}
                        <span>{tab.shortLabel}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
