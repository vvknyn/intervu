import { accessEvents, computeAccessUntil, DAY_MS } from "@/lib/billing/recompute";
import { paidThrough } from "@/lib/billing/access";
import type { Grant } from "@/lib/billing/profile-store";

/** How close to the end the account is told, in the app, that full access is ending. */
export const ENDS_SOON_MS = 7 * DAY_MS;

export type PlanSummary =
    | { status: "free" }
    | { status: "full"; until: number; gift: boolean; endsSoon: boolean; autoRenew: boolean };

/**
 * Pure. What an account's plan is now. `gift`: the dated grants alone reach the stored end,
 * so no payment extended it (any payment moves the end past the gift-only fold).
 * `autoRenew`: a month-to-month subscription is live, so `until` is the next charge date
 * (the stored end less its renewal slack) and the account is never told its access is ending.
 */
export function planSummary(s: { accessUntil: number; grants: readonly Grant[]; now: number; autoRenew?: boolean }): PlanSummary {
    if (s.accessUntil <= s.now) return { status: "free" };
    const autoRenew = s.autoRenew === true;
    const until = paidThrough(s.accessUntil, autoRenew);
    return {
        status: "full",
        until,
        gift: !autoRenew && computeAccessUntil(accessEvents([], s.grants)) === s.accessUntil,
        endsSoon: !autoRenew && until - s.now <= ENDS_SOON_MS,
        autoRenew,
    };
}
