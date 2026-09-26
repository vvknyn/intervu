"use client";

import { useEffect, useRef } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import { resolveDeckSwipe } from "@/lib/jobs/for-you/deck-swipe";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

/**
 * How many cards ahead of the active one to prefetch descriptions for.
 * Widened from 1 to 3 (2026-09-18, `perf(jobs): hydrate descriptions via GET
 * route`) now that each lookahead fetch is a plain `fetch` to
 * `GET /api/jobs/[id]/description` (lib/jobs/detail-fetch.ts) — independent
 * connections that run in parallel, not Server Action POSTs serialized
 * behind each other on Next's client action queue. `page.tsx`'s
 * `detailFetcher` in-flight/memo dedupe (keyed by id) still guarantees a
 * card already fetched — or already showing — is never fetched twice.
 */
export const FOR_YOU_PREFETCH_AHEAD = 3;

export interface ForYouDeckProps {
    packs: PublicJob[];
    activeIndex: number;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    onRetryDescription?: (jobId: string) => void;
    /** Horizontal swipe → previous/next. Optional so Search-adjacent mounts stay inert. */
    onSwipeNavigate?: (direction: "previous" | "next") => void;
    className?: string;
}

/**
 * Renders ONLY the active pack — no stacked offset cards behind it (that
 * was the "white box" peeking-edges defect). Keying on `pack.id` remounts
 * the card on every job change (scroll resets for free). Horizontal swipe
 * flips cards; vertical scroll inside the postcard JD stays native.
 */
export function ForYouDeck({
    packs,
    activeIndex,
    matchScores,
    resume,
    nowMs,
    hydratedJobs,
    onActivePackChange,
    onRetryDescription,
    onSwipeNavigate,
    className,
}: ForYouDeckProps) {
    useEffect(() => {
        const job = packs[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, packs.length, FOR_YOU_PREFETCH_AHEAD)) {
            onActivePackChange(packs[index].id);
        }
    }, [activeIndex, packs, onActivePackChange]);

    const touchStart = useRef<{ x: number; y: number } | null>(null);

    const activePack = packs[activeIndex];
    if (!activePack) return null;
    const hydrated = resolveDescriptionHydration(activePack, hydratedJobs.get(activePack.id));

    return (
        <div
            className={cn("relative touch-pan-y", className)}
            data-testid="for-you-deck"
            onTouchStart={(event) => {
                if (!onSwipeNavigate) return;
                const t = event.changedTouches[0];
                if (!t) return;
                touchStart.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(event) => {
                if (!onSwipeNavigate || !touchStart.current) return;
                const t = event.changedTouches[0];
                if (!t) return;
                const dx = t.clientX - touchStart.current.x;
                const dy = t.clientY - touchStart.current.y;
                touchStart.current = null;
                const direction = resolveDeckSwipe({ dx, dy });
                if (direction) onSwipeNavigate(direction);
            }}
        >
            <ForYouPack
                key={activePack.id}
                job={activePack}
                hydratedJob={hydrated.job}
                descriptionPending={hydrated.descriptionPending}
                matchScore={matchScores?.get(activePack.id) ?? null}
                resume={resume}
                nowMs={nowMs}
                onRetryDescription={
                    onRetryDescription ? () => onRetryDescription(activePack.id) : undefined
                }
                className="fade-in"
            />
        </div>
    );
}
