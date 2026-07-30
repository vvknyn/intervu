"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { cn } from "@/lib/utils";

function FindIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
        </svg>
    );
}

function TrackerIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="4" width="5" height="16" rx="1" />
            <rect x="10" y="4" width="5" height="10" rx="1" />
            <rect x="17" y="4" width="5" height="13" rx="1" />
        </svg>
    );
}

function ResumeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    );
}

function PrepIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
        </svg>
    );
}

const TAB_ICONS = [FindIcon, TrackerIcon, ResumeIcon, PrepIcon] as const;

export function MobileTabBar() {
    const pathname = usePathname();
    const hideNav = pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) return null;

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-border bg-card px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
        >
            {NAV_TABS.map((tab, i) => {
                const active = tab.match(pathname);
                const Icon = TAB_ICONS[i];
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
                        <Icon />
                        <span>{tab.shortLabel}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
