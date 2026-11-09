"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_ACCOUNT_TAB, NAV_TABS, mobilePrimaryTabs } from "@/components/layout/nav-tabs";
import { initialDockState, stepDock, type DockState } from "@/components/layout/dock-minimize";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { usePrefetchOnIntent } from "@/components/layout/use-prefetch-on-intent";
import { useSignedIn } from "@/hooks/use-signed-in";
import { hrefForSignedOut } from "@/lib/auth/product-routes";
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
 *  padded for the bar reads. The columns follow the tabs that are showing
 *  (`auto-cols-fr`), never a fixed count in an inline style: minimized, one tab
 *  is left and it must fill the whole round button. */
export function MobileTabBar() {
    const pathname = usePathname();
    const prefetchOnIntent = usePrefetchOnIntent();
    // Until someone is known to be signed in (hooks/use-signed-in.ts), the Account tab says where
    // /settings sends them (the sign-in page) instead of making every visitor and crawler follow a
    // redirect to find out.
    const signedIn = useSignedIn();
    // The minimize state lives on <html data-dock>; globals.css draws it, and only
    // when an accessory capsule is mounted (see dock-minimize.ts).
    const dock = useRef<DockState>(initialDockState());
    const hideNav = shouldHideSiteChrome(pathname);
    useEffect(() => {
        if (hideNav) return;
        const root = document.documentElement;
        const publish = () => {
            root.dataset.dock = dock.current.minimized ? "min" : "full";
        };
        dock.current = initialDockState(window.scrollY);
        publish();
        const onScroll = () => {
            const accessory = document.querySelector<HTMLElement>("[data-dock-accessory]");
            // Stuck at its offset the accessory's bottom IS that line; resting in the page (the end of it) it is above it.
            const resting = accessory
                ? accessory.getBoundingClientRect().bottom < window.innerHeight - parseFloat(getComputedStyle(accessory).bottom) - 2
                : false;
            const next = stepDock(dock.current, window.scrollY, root.scrollHeight - window.innerHeight, resting);
            const changed = next.minimized !== dock.current.minimized;
            dock.current = next;
            if (changed) publish();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            delete root.dataset.dock;
        };
    }, [pathname, hideNav]);

    if (hideNav) return null;

    // Minimized, the bar is one round button: a tap expands it, it does not navigate.
    const expandIfMinimized = (event: MouseEvent) => {
        const root = document.documentElement;
        if (root.dataset.dock !== "min" || !document.querySelector("[data-dock-accessory]")) return;
        event.preventDefault();
        event.stopPropagation();
        dock.current = { ...dock.current, minimized: false, run: 0 };
        root.dataset.dock = "full";
    };
    const currentTab = MOBILE_TABS.find((tab) => tab.match(pathname)) ?? MOBILE_TABS[0];

    return (
        <nav
            data-mobile-tabbar
            data-testid="mobile-tabbar"
            aria-label="Primary"
            onClickCapture={expandIfMinimized}
            className="dock-capsule fixed left-[calc((100vw-var(--dock-w))/2)] bottom-[var(--mobile-bottom-gap)] z-50 grid h-14 grid-flow-col auto-cols-fr items-center p-1 lg:hidden"
        >
            {MOBILE_TABS.map((tab) => {
                const active = tab.match(pathname);
                const Icon = tab.icon;
                // One word that never changes under the user (HIG Tab bars: "Use single words whenever
                // possible"); the résumé tab said "Add résumé" until a résumé existed.
                const label = tab.shortLabel;
                const href = signedIn ? tab.href : hrefForSignedOut(tab.href);
                return (
                    <Link
                        key={tab.href + tab.label}
                        href={href}
                        prefetch={false}
                        {...prefetchOnIntent(href)}
                        title={tab.title}
                        // Prefixed so a testid is unique page-wide: this bar
                        // shares NAV_TABS with the desktop TopBar and both are
                        // in the DOM at once (this one CSS-hidden at lg+) —
                        // bare tab.testId made every strict testid locator
                        // resolve to 2 elements.
                        data-testid={`mobile-${tab.testId}`}
                        data-tour={tab.tourSelector}
                        // The tab's name for VoiceOver, held on the link itself: minimized, the bar is one round
                        // button whose visible label is hidden, and it was announced as a link with no name.
                        aria-label={label}
                        aria-current={active ? "page" : undefined}
                        data-dock-current={tab === currentTab ? "" : undefined}
                        className={cn(
                            "flex h-full flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-pill text-xs transition-colors duration-100 press-fill",
                            CHROME_FOCUS_VISIBLE,
                            active ? "glass-selected text-foreground font-semibold" : "text-muted-foreground font-normal",
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
