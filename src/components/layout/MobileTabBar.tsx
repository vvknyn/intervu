"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthChange, type User } from "@/lib/firebase/client-auth";
import { MOBILE_ACCOUNT_TAB, NAV_TABS, RESUME_TAB, mobilePrimaryTabs } from "@/components/layout/nav-tabs";
import { useResumeTabLabel } from "@/components/layout/use-resume-tab-label";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { usePrefetchOnIntent } from "@/components/layout/use-prefetch-on-intent";
import { cn, CHROME_FOCUS_VISIBLE } from "@/lib/utils";

// `mobilePrimary: false` (nav-tabs.tsx) opts a tab OUT of this bar while it
// stays in the desktop nav — filtered on that one declarative field via
// `mobilePrimaryTabs`, never on a tab's name/href, so a future opt-out never
// needs a second change here.
/** Native phone primary nav: Jobs | Résumé | Tracker | Account.
 *  The AI pairing at /connect is reachable from Settings. */
const MOBILE_TABS = [...mobilePrimaryTabs(NAV_TABS), MOBILE_ACCOUNT_TAB];

/** The iOS tab bar in house paint: the lowest capsule of the phone dock
 *  (`dock-capsule`, globals.css: a floating glass capsule inset 16px from the
 *  screen's sides) lifted off the bottom edge by `--mobile-bottom-gap`, not a
 *  strip stuck to it. Anything else pinned at the bottom of a phone screen is
 *  the same capsule stacked above this one. 56px tall with 4px of
 *  padding, so each tab's hit area is 48px tall (HIG/Material minimum touch
 *  target is 44px); 20px icons (the one documented "icon sits in a stretched
 *  control" exception to the 16px site-wide default); the active tab is a
 *  filled pill, the rest are secondary text — no counts/dots (that's TopBar's
 *  desktop menu list's own affordance, not this bar's). The space it takes is
 *  `--mobile-tabbar-h` (globals.css), which everything fixed at the bottom or
 *  padded for the bar reads. */
export function MobileTabBar() {
    const pathname = usePathname();
    const prefetchOnIntent = usePrefetchOnIntent();
    const [user, setUser] = useState<User | null | undefined>(undefined);
    const resumeLabel = useResumeTabLabel(user?.uid ?? null, user !== undefined);

    useEffect(() => {
        const unsubscribe = onAuthChange((nextUser) => setUser(nextUser));
        return () => unsubscribe();
    }, []);

    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length}, minmax(0, 1fr))` }}
            className="dock-capsule fixed inset-x-0 bottom-[var(--mobile-bottom-gap)] z-50 grid h-14 items-center p-1 lg:hidden"
        >
            {MOBILE_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                const label = tab.href === RESUME_TAB.href ? resumeLabel : tab.shortLabel;
                return (
                    <Link
                        key={tab.href + tab.label}
                        href={tab.href}
                        prefetch={false}
                        {...prefetchOnIntent(tab.href)}
                        title={tab.title}
                        // Prefixed so a testid is unique page-wide: this bar
                        // shares NAV_TABS with the desktop TopBar and both are
                        // in the DOM at once (this one CSS-hidden at lg+) —
                        // bare tab.testId made every strict testid locator
                        // resolve to 2 elements.
                        data-testid={`mobile-${tab.testId}`}
                        data-tour={tab.tourSelector}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "flex h-full flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-pill text-xs transition-colors duration-100",
                            CHROME_FOCUS_VISIBLE,
                            active ? "bg-background text-foreground font-semibold" : "text-muted-foreground font-normal",
                        )}
                    >
                        {Icon && <Icon />}
                        <span>{label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
