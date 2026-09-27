"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { JobsHomeResolution } from "@/lib/jobs/for-you/home-view";
import { MOTION_DURATION_MS } from "@/lib/motion/interaction-contract";
import { shouldAnimateJobsHomeViewSwap } from "@/lib/motion/home-view-transition";
import { cn } from "@/lib/utils";

export interface JobsHomeViewTransitionProps {
    surface: JobsHomeResolution;
    children: ReactNode;
    className?: string;
}

/**
 * Crossfades the /jobs main column when toggling For you ↔ Search.
 * Skips the first paint and pending↔resolved handoffs (no Search chrome flash).
 */
export function JobsHomeViewTransition({ surface, children, className }: JobsHomeViewTransitionProps) {
    const previousSurface = useRef<JobsHomeResolution>(surface);
    const [crossfade, setCrossfade] = useState(false);

    useLayoutEffect(() => {
        const prev = previousSurface.current;
        previousSurface.current = surface;
        if (!shouldAnimateJobsHomeViewSwap(prev, surface)) {
            setCrossfade(false);
            return;
        }
        setCrossfade(true);
        const timer = window.setTimeout(() => setCrossfade(false), MOTION_DURATION_MS.page + 32);
        return () => window.clearTimeout(timer);
    }, [surface]);

    return (
        <div
            data-testid="jobs-home-view-transition"
            data-home-surface={surface}
            className={cn(crossfade && "jobs-home-view-crossfade", className)}
        >
            {children}
        </div>
    );
}
