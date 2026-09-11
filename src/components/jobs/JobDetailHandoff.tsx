"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
    resolveJobDetailHandoff,
    type JobDetailHandoffKind,
    type JobDetailHandoffSurface,
} from "@/lib/jobs/job-detail-handoff";

export interface JobDetailHandoffProps {
    identity: string | null;
    explicit: boolean;
    surface: JobDetailHandoffSurface;
    children: ReactNode;
}

function reducedMotionNow(hookValue: boolean | null): boolean | null {
    if (hookValue != null) return hookValue;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return hookValue;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Clip/mask/overlap wrapper for the SERP detail pane and mobile sheet.
 * Retriggers CSS by toggling `job-detail-handoff-playing` (reflow) without
 * remounting `children` — JobDetail already keys on job id, and an extra
 * remount would re-fire related-jobs / open-count fetches.
 */
export function JobDetailHandoff({ identity, explicit, surface, children }: JobDetailHandoffProps) {
    const reducedMotion = useReducedMotion();
    const prevRef = useRef<{ id: string | null; explicit: boolean } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [play, setPlay] = useState<{ kind: JobDetailHandoffKind; nonce: number }>({
        kind: "none",
        nonce: 0,
    });

    useLayoutEffect(() => {
        const previous = prevRef.current ?? { id: null, explicit: false };
        const identityChanged = previous.id !== identity;
        const explicitChanged = previous.explicit !== explicit;
        // Ignore reduced-motion hydration (null → true/false) so it cannot
        // re-resolve an in-flight clip as "none" and abort it. OS-setting
        // is read at the moment selection identity actually changes.
        if (prevRef.current && !identityChanged && !explicitChanged) return;

        const nextKind = resolveJobDetailHandoff({
            previousId: previous.id,
            nextId: identity,
            previousExplicit: previous.explicit,
            nextExplicit: explicit,
            surface,
            reducedMotion: reducedMotionNow(reducedMotion),
        });

        prevRef.current = { id: identity, explicit };
        setPlay((current) => ({
            kind: nextKind,
            nonce: nextKind === "clip" || nextKind === "fade" ? current.nonce + 1 : current.nonce,
        }));
    }, [identity, explicit, surface, reducedMotion]);

    const { kind, nonce } = play;
    const isPlaying = kind === "clip" || kind === "fade";

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        if (!isPlaying) {
            root.classList.remove("job-detail-handoff-playing");
            return;
        }
        // Restart even when kind stays "clip" across job A → job B. Playing
        // lives in React className so a later render cannot wipe it; the
        // reflow is what retriggers the CSS animation.
        root.classList.remove("job-detail-handoff-playing");
        void root.offsetWidth;
        root.classList.add("job-detail-handoff-playing");
    }, [nonce, isPlaying]);

    return (
        <div
            ref={rootRef}
            data-testid="job-detail-handoff"
            data-handoff={kind}
            data-surface={surface}
            className={cn(
                "job-detail-handoff relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-none",
                isPlaying && "job-detail-handoff-playing",
                kind === "fade" && "job-handoff-fade",
            )}
        >
            {kind === "clip" && (
                <>
                    <div
                        key={`overlap-${nonce}`}
                        className="job-detail-handoff-overlap pointer-events-none absolute inset-0 z-[1] rounded-none bg-background"
                        aria-hidden
                    />
                    <div
                        key={`blade-${nonce}`}
                        className="job-detail-handoff-blade pointer-events-none absolute z-[3] rounded-none bg-brand"
                        aria-hidden
                    />
                </>
            )}
            <div
                className={cn(
                    "job-detail-handoff-body relative z-[2] flex min-h-0 flex-1 flex-col",
                    kind === "clip" && "job-detail-handoff-body-clip",
                )}
            >
                {children}
            </div>
        </div>
    );
}
