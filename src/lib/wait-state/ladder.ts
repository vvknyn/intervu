/**
 * The wait-state ladder — the ONE place that decides what a wait looks like
 * after `t` ms. Pure: `WaitState` (components/ui/wait-state.tsx) owns only the
 * clock.
 *
 *   < 300 ms   nothing visible (no flash for waits nobody perceives)
 *   300 ms–2 s a skeleton, only when the caller supplied one shaped like the
 *              final layout; otherwise a bare spinner
 *   > 2 s      a status line — the caller's real progress text, else the label
 *   > 8 s      one light line saying the wait is longer than usual
 *
 * Every line is a fact: the label names what is loading, `status` comes from a
 * real progress event, and the patience line is only true because 8 s passed.
 */

export const WAIT_SKELETON_AFTER_MS = 300;
export const WAIT_STATUS_AFTER_MS = 2_000;
export const WAIT_PATIENCE_AFTER_MS = 8_000;

export const WAIT_PATIENCE_LINE = "Still working. This one is taking longer than usual.";

export type WaitStage = "quiet" | "skeleton" | "status" | "patience";

/** Stage boundaries in order — the component schedules one timer per entry. */
export const WAIT_STAGE_STARTS: readonly (readonly [Exclude<WaitStage, "quiet">, number])[] = [
    ["skeleton", WAIT_SKELETON_AFTER_MS],
    ["status", WAIT_STATUS_AFTER_MS],
    ["patience", WAIT_PATIENCE_AFTER_MS],
];

export function waitStageAt(elapsedMs: number): WaitStage {
    let stage: WaitStage = "quiet";
    for (const [name, startsAt] of WAIT_STAGE_STARTS) {
        if (elapsedMs >= startsAt) stage = name;
    }
    return stage;
}

export interface WaitView {
    /** "hidden" keeps the skeleton's geometry (no layout shift) without painting it. */
    skeleton: "none" | "hidden" | "shown";
    spinner: boolean;
    text: boolean;
    patience: boolean;
}

export function waitViewFor(stage: WaitStage, hasSkeleton: boolean): WaitView {
    const quiet = stage === "quiet";
    const textual = stage === "status" || stage === "patience";
    return {
        skeleton: !hasSkeleton ? "none" : quiet ? "hidden" : "shown",
        spinner: !quiet && (!hasSkeleton || textual),
        text: textual,
        patience: stage === "patience",
    };
}
