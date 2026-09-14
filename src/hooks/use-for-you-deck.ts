"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clampDeckIndex } from "@/lib/jobs/for-you/deck-index";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Owns for-you deck progress (active card + skipped ids) at the seam that
 * survives a Search <-> For-you toggle. `page.tsx` calls this unconditionally
 * and never unmounts across that toggle; `ForYouHome`/`ForYouDeck` below it
 * do unmount (the toggle renders one branch or the other). State that must
 * outlive the toggle cannot live inside the branch the toggle switches — it
 * has to live one level up, here.
 */
export function useForYouDeck(packs: PublicJob[]) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());

    const visiblePacks = useMemo(
        () => packs.filter((p) => !skippedIds.has(p.id)),
        [packs, skippedIds],
    );

    useEffect(() => {
        setActiveIndex((i) => clampDeckIndex(i, visiblePacks.length));
    }, [visiblePacks.length]);

    const activeJob = visiblePacks[activeIndex] ?? null;

    // Skipping removes the active card from `visiblePacks`, which already
    // slides the next card into `activeIndex` (the resize effect above keeps
    // it in range). Also advancing the index here was the prior bug — it
    // skipped a second, never-shown card on every click.
    const handleSkip = useCallback(() => {
        if (!activeJob) return;
        setSkippedIds((prev) => new Set(prev).add(activeJob.id));
    }, [activeJob]);

    return { visiblePacks, activeIndex, setActiveIndex, activeJob, handleSkip };
}
