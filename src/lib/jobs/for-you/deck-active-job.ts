import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";

/**
 * The active for-you card is identified by job id, not by position in the
 * list. `forYouPacks` (and therefore `visiblePacks`) can reorder or resize
 * for reasons that have nothing to do with the user skipping a card -- an
 * async match-score re-sort, or the Search view mutating the same
 * underlying list while the user is toggled away from For-you. An index
 * has no way to tell "the user skipped forward" apart from "the list
 * changed under me"; an id does, because it keeps pointing at the same job
 * regardless of where that job now sits.
 */

/**
 * Locate the active job's index by identity. Reordering never changes
 * which job is active as long as its id is still present in
 * `visiblePacks`. Returns -1 when it is not present, so the caller can
 * apply the right recovery rule for *why* it's gone.
 */
export function findActiveIndexById(
    visiblePacks: Pick<{ id: string }, "id">[],
    activeJobId: string | null,
): number {
    if (activeJobId == null) return -1;
    return visiblePacks.findIndex((p) => p.id === activeJobId);
}

/**
 * The job id that becomes active after a skip removes the job that was
 * active at `activeIndexBeforeSkip`: whichever job slides into that same
 * slot once the skipped job is filtered out of `remainingPacks` (clamped
 * to the new, possibly-shorter list) -- never the first card.
 */
export function nextActiveIdAfterSkip(
    remainingPacks: Pick<{ id: string }, "id">[],
    activeIndexBeforeSkip: number,
): string | null {
    const index = clampDeckIndex(activeIndexBeforeSkip, remainingPacks.length);
    return remainingPacks[index]?.id ?? null;
}

/**
 * The job id that becomes active when the previously-active job is gone
 * from `visiblePacks` for any reason OTHER than a skip (the list was
 * replaced or filtered, or nothing has been made active yet): the first
 * card, or null when the deck is empty.
 */
export function fallbackActiveId(visiblePacks: Pick<{ id: string }, "id">[]): string | null {
    return visiblePacks[0]?.id ?? null;
}
