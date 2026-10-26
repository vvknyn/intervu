"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The mobile/desktop split every compact presentation uses (filters Sheet, search view): below `lg` is compact. */
export const LG_UP_QUERY = "(min-width: 1024px)";

/**
 * SSR-safe `matchMedia` hook — same `useSyncExternalStore` triple idiom
 * jobs/page.tsx already uses for other external browser state
 * (`recentSearches`/`locationDefaultSuppressed`, backed by
 * lib/jobs/recent-searches.ts / location-default-preference.ts). Unlike
 * those, there's nothing to cache here (matchMedia is itself the live
 * source), so subscribe/getSnapshot are built fresh per `query` rather than
 * module-level singletons — memoized with `useCallback` keyed on `query` so
 * a stable identity survives re-renders (required by
 * `useSyncExternalStore`, which resubscribes whenever `subscribe` changes
 * identity) while still supporting more than one distinct query in the app.
 *
 * Server snapshot is always `false` — this app's default rendering is
 * "below breakpoint" (the desktop split view's pane is a progressive
 * enhancement over the mobile-first sheet), so a desktop client renders one
 * frame as below-breakpoint before hydration corrects it, never the
 * reverse.
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const mql = window.matchMedia(query);
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        },
        [query],
    );
    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
    const getServerSnapshot = useCallback(() => false, []);

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The phone width: where Tailwind's `max-sm:` applies and where overlays take
 *  their compact form (Dialog and choice lists as bottom sheets, tooltips kept
 *  on the screen). One query so the CSS and JS sides cannot drift. */
export const COMPACT_QUERY = "(max-width: 639px)";

export function useIsCompact(): boolean {
    return useMediaQuery(COMPACT_QUERY);
}
