"use client";

import { useEffect, useRef } from "react";
import { ForYouPack } from "@/components/jobs/for-you/ForYouPack";
import { shouldPackGestureAdvanceDeck } from "@/lib/jobs/for-you/deck-wheel";
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
    const rootRef = useRef<HTMLDivElement>(null);
    const wheelLock = useRef(false);
    const touchStart = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);
    const activeIndexRef = useRef(activeIndex);
    const packsLengthRef = useRef(packs.length);
    const onActiveIndexChangeRef = useRef(onActiveIndexChange);
    activeIndexRef.current = activeIndex;
    packsLengthRef.current = packs.length;
    onActiveIndexChangeRef.current = onActiveIndexChange;

    useEffect(() => {
        const job = packs[activeIndex];
        if (job) onActivePackChange(job.id);
        const next = packs[activeIndex + 1];
        if (next) onActivePackChange(next.id);
    }, [activeIndex, packs, onActivePackChange]);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const onWheel = (event: WheelEvent) => {
            const direction: 1 | -1 = event.deltaY > 0 ? 1 : -1;
            if (!shouldPackGestureAdvanceDeck(event.target, el, direction)) return;
            const length = packsLengthRef.current;
            const index = activeIndexRef.current;
            if (wheelLock.current || length <= 1) return;
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (Math.abs(event.deltaY) < (reduced ? 80 : 40)) return;
            event.preventDefault();
            wheelLock.current = true;
            if (direction > 0) {
                onActiveIndexChangeRef.current(Math.min(index + 1, length - 1));
            } else {
                onActiveIndexChangeRef.current(Math.max(index - 1, 0));
            }
            window.setTimeout(() => {
                wheelLock.current = false;
            }, reduced ? 0 : 280);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    const handleTouchStart = (event: React.TouchEvent) => {
        const touch = event.changedTouches[0];
        if (!touch) return;
        touchStart.current = { x: touch.clientX, y: touch.clientY, target: event.target };
    };

    const handleTouchEnd = (event: React.TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        if (wheelLock.current || packs.length <= 1) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const threshold = reduced ? 80 : 40;
        if (Math.abs(dy) < threshold || Math.abs(dy) <= Math.abs(dx)) return;
        const direction: 1 | -1 = dy < 0 ? 1 : -1;
        if (!shouldPackGestureAdvanceDeck(start.target, rootRef.current, direction)) return;
        wheelLock.current = true;
        if (direction > 0) {
            onActiveIndexChange(Math.min(activeIndex + 1, packs.length - 1));
        } else {
            onActiveIndexChange(Math.max(activeIndex - 1, 0));
        }
        window.setTimeout(() => {
            wheelLock.current = false;
        }, reduced ? 0 : 280);
    };

    return (
        <div
            ref={rootRef}
            className={cn("relative min-h-0 flex-1 overflow-hidden pb-6", className)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {packs.map((pack, index) => {
                const offset = index - activeIndex;
                if (offset < 0 || offset > 2) return null;
                const isActive = offset === 0;
                const hydrated = hydratedJobs.get(pack.id);
                return (
                    <div
                        key={pack.id}
                        className={cn(
                            "absolute inset-x-0 top-0 bottom-6 min-h-0 transition-transform motion-reduce:transition-none",
                            isActive
                                ? "z-20"
                                : "z-10 pointer-events-none",
                        )}
                        style={
                            isActive
                                ? undefined
                                : {
                                      transform: `translateY(${offset * 16}px) scale(${1 - offset * 0.03})`,
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
                            className={cn("h-full", !isActive && "opacity-90")}
                        />
                    </div>
                );
            })}
        </div>
    );
}
