import { useEffect, useState } from "react";
import { resolveDescriptionSectionState } from "@/lib/jobs/description-section-state";
import { formatDescription } from "@/lib/jobs/format-description";

/**
 * Below-the-fold gate for JobDetail's non-description fetches (related jobs,
 * company open count, and any future one). "pending" — the description
 * hasn't settled yet (not hydrated, or hydrated but the live fill is still
 * running); "ready" — a real description body is showing; "empty" —
 * hydration settled and the job genuinely has no description. The gate
 * (`useDescriptionSettled` below) opens on "ready" OR "empty", never only on
 * non-empty text — a description-less job must still load its related
 * jobs/company count (tri-state lesson: no map entry ≠ empty).
 */
export type DescriptionSettleState = "pending" | "ready" | "empty";

/**
 * Built on `resolveDescriptionSectionState` (description-section-state.ts) —
 * the single source of truth JobDetail's own description render switch
 * already reads — so this collapses its 4-value output (`body`/`loading`/
 * `pending`/`empty`) down to the 3 states the gate cares about instead of
 * deciding pending/empty a second, possibly-drifting way.
 */
export function descriptionState(job: { description?: string | null; descriptionPending?: boolean }): DescriptionSettleState {
    const section = resolveDescriptionSectionState({
        hydrated: job.description !== undefined,
        hasBlocks: formatDescription(job.description).length > 0,
        pending: Boolean(job.descriptionPending),
    });
    if (section === "body") return "ready";
    if (section === "empty") return "empty";
    return "pending"; // "loading" (not hydrated) or "pending" (live fill still running)
}

/**
 * True once the description has SETTLED (ready or empty). Flips from false
 * to true in a `useEffect` — i.e. on the render AFTER the one where the
 * description state became ready/empty, so it commits (paints) before this
 * flips — never synchronously during that render. Callers gate their
 * below-the-fold effects on this (both in the guard and in the deps array)
 * so those fetches never race the description paint.
 */
export function useDescriptionSettled(job: { description?: string | null; descriptionPending?: boolean }): boolean {
    const state = descriptionState(job);
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        if (state === "pending") return;
        setSettled(true);
    }, [state]);
    return settled;
}
