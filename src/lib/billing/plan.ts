import { accessEvents, computeAccessUntil, DAY_MS } from "@/lib/billing/recompute";
import type { Grant } from "@/lib/billing/profile-store";

/** How close to the end the account is told, in the app, that full access is ending. */
export const ENDS_SOON_MS = 7 * DAY_MS;

export type PlanSummary = { status: "free" } | { status: "full"; until: number; gift: boolean; endsSoon: boolean };

/**
 * Pure. What an account's plan is now. `gift`: the dated grants alone reach the stored end,
 * so no payment extended it (any payment moves the end past the gift-only fold).
 */
export function planSummary(s: { accessUntil: number; grants: readonly Grant[]; now: number }): PlanSummary {
    if (s.accessUntil <= s.now) return { status: "free" };
    return {
        status: "full",
        until: s.accessUntil,
        gift: computeAccessUntil(accessEvents([], s.grants)) === s.accessUntil,
        endsSoon: s.accessUntil - s.now <= ENDS_SOON_MS,
    };
}
