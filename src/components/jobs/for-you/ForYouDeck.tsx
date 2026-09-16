"use client";

import { useEffect } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

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
 * `onActivePackChange` still fires for the active AND next job so
 * description prefetch (owned by the caller) keeps working.
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
        const next = packs[activeIndex + 1];
        if (next) onActivePackChange(next.id);
    }, [activeIndex, packs, onActivePackChange]);

    const activePack = packs[activeIndex];
    if (!activePack) return null;
    const hydrated = resolveDescriptionHydration(activePack, hydratedJobs.get(activePack.id));

    return (
        <div className={cn("relative min-h-0 flex-1 overflow-hidden", className)}>
            <ForYouPack
                key={activePack.id}
                job={activePack}
                hydratedJob={hydrated.job}
                descriptionPending={hydrated.descriptionPending}
                matchScore={matchScores?.get(activePack.id) ?? null}
                resume={resume}
                nowMs={nowMs}
                className="fade-in h-full"
            />
        </div>
    );
}
