"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";
import {
    fallbackActiveId,
    findActiveIndexById,
    nextActiveIdAfterSkip,
} from "@/lib/jobs/for-you/deck-active-job";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Owns for-you deck progress (active card + skipped ids) at the seam that
 * survives a Search <-> For-you toggle. `page.tsx` calls this unconditionally
 * and never unmounts across that toggle; `ForYouHome`/`ForYouDeck` below it
 * do unmount (the toggle renders one branch or the other). State that must
 * outlive the toggle cannot live inside the branch the toggle switches — it
 * has to live one level up, here.
 *
 * The active card is tracked by job id (`activeJobId`), not by index.
 * `packs` keeps tracking Search results while the user is toggled away
 * (needed so a resize doesn't zero the index -- see the effect below), and
 * `renderedClusters` upstream re-sorts as match scores resolve even with no
 * toggle at all. An index into a list that reorders or resizes for reasons
 * other than the user's own skip is not a stable reference to "the card the
 * user is looking at"; an id is.
 */
export function useForYouDeck(packs: PublicJob[]) {
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());

    const visiblePacks = useMemo(
        () => packs.filter((p) => !skippedIds.has(p.id)),
        [packs, skippedIds],
    );

    const activeIndex = useMemo(() => {
        const idx = findActiveIndexById(visiblePacks, activeJobId);
        return idx === -1 ? 0 : idx;
    }, [visiblePacks, activeJobId]);

    // The active job stays active by id even when `visiblePacks` reorders.
    // When it's missing for any reason other than the skip below (which
    // repairs the id itself, synchronously, before this can even run) --
    // a replaced or filtered list, or first mount -- fall back to the
    // first card.
    useEffect(() => {
        if (visiblePacks.length === 0) {
            if (activeJobId !== null) setActiveJobId(null);
            return;
        }
        if (findActiveIndexById(visiblePacks, activeJobId) !== -1) return;
        setActiveJobId(fallbackActiveId(visiblePacks));
    }, [visiblePacks, activeJobId]);

    const activeJob = visiblePacks[activeIndex] ?? null;

    const setActiveIndex = useCallback(
        (index: number) => {
            const clamped = clampDeckIndex(index, visiblePacks.length);
            setActiveJobId(visiblePacks[clamped]?.id ?? null);
        },
        [visiblePacks],
    );

    // Skipping removes the active card from `visiblePacks`. The job that
    // slides into its former slot becomes active by id -- not the first
    // card, and not whatever a stale index would now point at -- so a
    // later re-sort still finds the right job instead of drifting by
    // position. (This is also the fix for the old double-advance bug: only
    // one state update decides the next active job, not an index bump
    // *plus* the resize effect both moving it.)
    const handleSkip = useCallback(() => {
        if (!activeJob) return;
        const skippedId = activeJob.id;
        const remaining = visiblePacks.filter((p) => p.id !== skippedId);
        setSkippedIds((prev) => new Set(prev).add(skippedId));
        setActiveJobId(nextActiveIdAfterSkip(remaining, activeIndex));
    }, [activeJob, activeIndex, visiblePacks]);

    return { visiblePacks, activeIndex, setActiveIndex, activeJob, handleSkip };
}
