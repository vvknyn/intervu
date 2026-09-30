"use client";

import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { countOpenPursuits } from "@/lib/pursuits/tracker-display";
import type { NavBadge } from "@/components/layout/nav-tabs";

/**
 * Resolves every counter a nav tab can declare (`NavTab["badge"]`), in one
 * place, so the desktop bar and the mobile tab bar can never show different
 * numbers for the same tab. Adding a counter means adding a `NavBadge` member
 * and a line here — not a second copy of the lookup in each bar.
 *
 * `usePursuits` keeps its own module-level cache and auth subscription, so the
 * extra caller costs a subscription rather than a second fetch, and a tracked
 * job saved on /jobs updates the badge without a reload.
 *
 * The Tracker count is open roles only (`countOpenPursuits`).
 */
export function useNavBadgeCounts(): Record<NavBadge, number> {
    const { pursuits } = usePursuits();
    return { pursuits: countOpenPursuits(pursuits) };
}
