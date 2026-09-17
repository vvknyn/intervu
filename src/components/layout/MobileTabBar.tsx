"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_ACCOUNT_TAB, NAV_TABS, mobilePrimaryTabs } from "@/components/layout/nav-tabs";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { cn } from "@/lib/utils";

// `mobilePrimary: false` (nav-tabs.tsx) opts a tab OUT of this bar while it
// stays in the desktop nav — filtered on that one declarative field via
// `mobilePrimaryTabs`, never on a tab's name/href, so a future opt-out never
// needs a second change here.
const MOBILE_TABS = [...mobilePrimaryTabs(NAV_TABS), MOBILE_ACCOUNT_TAB];

/** HIG tab bar in house paint: 48px + the safe-area inset, hit areas
 *  stretched to the bar's full height (HIG/Material minimum touch target is
 *  44px — a bar-height tab clears that with room to spare), 20px icons (the
 *  one documented "icon sits in a stretched control" exception to the 16px
 *  site-wide default), Klein tint on the active tab, secondary on the rest —
 *  no counts/dots (that's TopBar's desktop menu list's own affordance, not
 *  this bar's). */
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
            className="fixed inset-x-0 bottom-0 z-50 grid h-[calc(var(--mobile-tabbar-h,56px)+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] items-center border-t border-border bg-background px-1 lg:hidden"
        >
            {MOBILE_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                return (
                    <Link
                        key={tab.href + tab.label}
                        href={tab.href}
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
                            "flex h-full flex-col items-center justify-center gap-0.5 whitespace-nowrap text-xs font-normal transition-colors duration-100 [&_svg]:size-5",
                            active ? "text-brand" : "text-muted-foreground",
                        )}
                    >
                        {Icon && <Icon />}
                        <span>{tab.shortLabel}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
