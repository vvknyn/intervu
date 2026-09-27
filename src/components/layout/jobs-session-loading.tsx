"use client";

import { RotatingLoadingCopy } from "@/components/jobs/for-you/RotatingLoadingCopy";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Stable jobs for-you column — pairs with `.jobs-session-frame` in globals.css. */
export const JOBS_SESSION_FRAME_CLASS = "jobs-session-frame";

/** JD skeleton column height — pairs with `.jobs-session-scroll` in globals.css. */
export const JOBS_SESSION_SCROLL_CLASS = "jobs-session-scroll";

/** @deprecated Use JOBS_SESSION_FRAME_CLASS — kept for existing imports/tests. */
export const FOR_YOU_HOME_FRAME_CLASS = JOBS_SESSION_FRAME_CLASS;

type DeckSkeletonTone = "postcard" | "session";

const PAPER_SLOT_CLASS: Record<DeckSkeletonTone, string> = {
    postcard: "for-you-deck-paper-postcard",
    session: "for-you-deck-paper-raised",
};

/** Shared deck/hub footprint — poster ground; paper slot only where the live pack sits. */
export function ForYouDeckSkeleton({
    tone = "postcard",
    withStatus = false,
    statusLabel,
    statusProminent = false,
}: {
    tone?: DeckSkeletonTone;
    withStatus?: boolean;
    /** Visible status line (session pending). When set, replaces rotating deck copy. */
    statusLabel?: string;
    /** Session gate — body-sm + live indicator (label text unchanged for a11y). */
    statusProminent?: boolean;
}) {
    return (
        <div className="space-y-3">
            {withStatus || statusLabel ? (
                statusLabel ? (
                    statusProminent ? (
                        <p
                            className="flex items-center gap-2 px-1 text-body-sm font-semibold text-foreground"
                            data-testid="jobs-session-loading-status"
                        >
                            <span
                                className="size-1.5 shrink-0 rounded-pill bg-live instrument-breathe"
                                aria-hidden
                            />
                            <span>{statusLabel}</span>
                        </p>
                    ) : (
                        <p
                            className="px-1 text-xs font-semibold text-muted-foreground"
                            data-testid="jobs-session-loading-status"
                        >
                            {statusLabel}
                        </p>
                    )
                ) : (
                    <RotatingLoadingCopy variant="deck" className="px-1 text-xs font-semibold" />
                )
            ) : null}
            <div className={PAPER_SLOT_CLASS[tone]} aria-hidden>
                <div className="border-b border-border py-4 px-4 lg:py-6 lg:px-8">
                    <div className="flex items-start gap-3">
                        <Skeleton className="size-10 shrink-0" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-5 w-2/3" />
                            <Skeleton className="h-3 w-40" />
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="h-7 w-16" />
                    </div>
                </div>
                <div className="grid gap-6 py-4 px-4 lg:grid-cols-[280px_1fr] lg:py-6 lg:px-8">
                    <div className="for-you-deck-fit-inset hidden rounded-ctl border border-border p-4 lg:block">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="mt-3 h-2 w-full" />
                        <Skeleton className="mt-4 h-3 w-24" />
                        <Skeleton className="mt-2 h-2 w-full" />
                    </div>
                    <div className={cn(JOBS_SESSION_SCROLL_CLASS, "space-y-3")}>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                    </div>
                </div>
            </div>
        </div>
    );
}

const SESSION_LOADING_LABEL = "Loading your session…";

/** Poster-toned auth/resume presence gate on /jobs — mounts inside `.jobs-session-frame`. */
export function JobsSessionLoadingShell({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-1 flex-col state-opacity-in poster-noise rounded-panel bg-background p-2",
                className,
            )}
            data-testid="jobs-session-loading"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">{SESSION_LOADING_LABEL}</span>
            <ForYouDeckSkeleton
                tone="session"
                statusLabel={SESSION_LOADING_LABEL}
                statusProminent
            />
        </div>
    );
}

export { SESSION_LOADING_LABEL };
