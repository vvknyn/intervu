"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { cn } from "@/lib/utils";

export function MobileTabBar() {
    const pathname = usePathname();
    const hideNav = pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) return null;

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            // Column count comes from NAV_TABS.length, not a fixed
            // `grid-cols-4` — a tab added or removed there reshapes the row
            // by construction instead of needing a matching class edit here
            // (the old failure mode: a `TAB_ICONS` array of 4 kept in
            // lockstep with NAV_TABS by hand, see nav-tabs.tsx's comment).
            style={{ gridTemplateColumns: `repeat(${NAV_TABS.length}, minmax(0, 1fr))` }}
            className="fixed inset-x-0 bottom-0 z-50 grid border-t border-border bg-card px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
        >
            {NAV_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href}
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
