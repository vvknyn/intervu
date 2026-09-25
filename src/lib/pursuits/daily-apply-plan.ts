/**
 * Soft daily apply pace (10–15 tailored applies). Tracks only real
 * `applied_at` timestamps via `countAppliedSince` — never paywall apply_counters.
 */
import { countAppliedSince } from "@/lib/pursuits/tracker-display";
import type { Pursuit } from "@/lib/pursuits/types";

/** Default daily goal — middle of the 10–15 soft pace. */
export const DEFAULT_DAILY_APPLY_GOAL = 12;

/** Soft pace copy for hub tip — quiet Swiss, no AI-slop. */
export const DAILY_APPLY_HUB_TIP =
    "Aim for 10–15 tailored applies today. Tracker counts mark-applied.";

/** Local calendar day start in the user's timezone (ms). */
export function startOfLocalDay(nowMs: number = Date.now()): number {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function countAppliedToday(pursuits: Pursuit[], nowMs: number = Date.now()): number {
    return countAppliedSince(pursuits, startOfLocalDay(nowMs));
}

export function remainingInDailyPlan(
    appliedToday: number,
    goal: number = DEFAULT_DAILY_APPLY_GOAL,
): number {
    return Math.max(0, goal - Math.max(0, appliedToday));
}

/**
 * Quiet applied-today status (hub tip /yours — not deck top chrome).
 * Hides remaining when appliedToday ≥ goal.
 */
export function formatAppliedTodayChrome(
    appliedToday: number,
    goal: number = DEFAULT_DAILY_APPLY_GOAL,
): string {
    const applied = Math.max(0, Math.floor(appliedToday));
    const left = remainingInDailyPlan(applied, goal);
    if (left <= 0) return `Applied today ${applied}`;
    return `Applied today ${applied} · ${left} left in today’s plan`;
}

/** Corpus depth near Show more — not deck top nav. */
export function formatDeckShowingLine(loaded: number, total: number | null | undefined): string | null {
    if (total == null || !Number.isFinite(total) || total < 0) return null;
    const n = Math.floor(loaded);
    const t = Math.floor(total);
    if (t <= 0) return null;
    return `${n} of ~${t.toLocaleString()} · Strong first`;
}
