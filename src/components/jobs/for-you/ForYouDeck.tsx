"use client";

import { useEffect } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
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
    className?: string;
}

/**
 * Renders ONLY the active pack — no stacked offset cards behind it (that
 * was the "white box" peeking-edges defect, and the source of the old
 * wheel/touch gesture code below it that tried to route scroll gestures
 * around them). Keying on `pack.id` remounts the card on every job change,
 * which is also what resets its scroll position to the top for free.
 * `onActivePackChange` still fires for the active card AND the next
 * `FOR_YOU_PREFETCH_AHEAD` cards so description prefetch (owned by the
 * caller) keeps working.
 */
export function ForYouDeck({
    packs,
    activeIndex,
    matchScores,
    resume,
    nowMs,
    hydratedJobs,
    onActivePackChange,
    className,
}: ForYouDeckProps) {
    useEffect(() => {
        const job = packs[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, packs.length, FOR_YOU_PREFETCH_AHEAD)) {
            onActivePackChange(packs[index].id);
        }
    }, [activeIndex, packs, onActivePackChange]);

    const activePack = packs[activeIndex];
    if (!activePack) return null;
    const hydrated = resolveDescriptionHydration(activePack, hydratedJobs.get(activePack.id));

    return (
        <div className={cn("relative", className)}>
            <ForYouPack
                key={activePack.id}
                job={activePack}
                hydratedJob={hydrated.job}
                descriptionPending={hydrated.descriptionPending}
                matchScore={matchScores?.get(activePack.id) ?? null}
                resume={resume}
                nowMs={nowMs}
                className="fade-in min-h-[min(72dvh,800px)]"
            />
        </div>
    );
}
