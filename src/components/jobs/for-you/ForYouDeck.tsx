"use client";

import { useEffect, useRef } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { shouldAdvancePackOnWheel } from "@/lib/jobs/for-you/deck-wheel";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

export interface ForYouDeckProps {
    packs: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    className?: string;
}

export function ForYouDeck({
    packs,
    activeIndex,
    onActiveIndexChange,
    matchScores,
    resume,
    nowMs,
    hydratedJobs,
    onActivePackChange,
    className,
}: ForYouDeckProps) {
    const wheelLock = useRef(false);

    useEffect(() => {
        const job = packs[activeIndex];
        if (job) onActivePackChange(job.id);
        const next = packs[activeIndex + 1];
        if (next) onActivePackChange(next.id);
    }, [activeIndex, packs, onActivePackChange]);

    const handleWheel = (event: React.WheelEvent) => {
        if (!shouldAdvancePackOnWheel(event.target)) return;
        if (wheelLock.current || packs.length <= 1) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (Math.abs(event.deltaY) < (reduced ? 80 : 40)) return;
        wheelLock.current = true;
        if (event.deltaY > 0) {
            onActiveIndexChange(Math.min(activeIndex + 1, packs.length - 1));
        } else {
            onActiveIndexChange(Math.max(activeIndex - 1, 0));
        }
        window.setTimeout(() => {
            wheelLock.current = false;
        }, reduced ? 0 : 280);
    };

    return (
        <div className={cn("relative", className)} onWheel={handleWheel}>
            {packs.map((pack, index) => {
                const offset = index - activeIndex;
                if (offset < 0 || offset > 2) return null;
                const isActive = offset === 0;
                const hydrated = hydratedJobs.get(pack.id);
                return (
                    <div
                        key={pack.id}
                        className={cn(
                            "transition-transform motion-reduce:transition-none",
                            isActive ? "relative z-20" : "absolute inset-x-0 top-0 z-10 pointer-events-none",
                        )}
                        style={
                            isActive
                                ? undefined
                                : {
                                      transform: `translateY(${offset * 12}px) scale(${1 - offset * 0.03})`,
                                  }
                        }
                        aria-hidden={!isActive}
                    >
                        <ForYouPack
                            job={pack}
                            hydratedJob={hydrated?.job}
                            descriptionPending={hydrated?.descriptionPending}
                            matchScore={matchScores?.get(pack.id) ?? null}
                            resume={resume}
                            nowMs={nowMs}
                            className={cn(!isActive && "opacity-90")}
                        />
                    </div>
                );
            })}
        </div>
    );
}
