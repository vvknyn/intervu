import type { JobsHomeResolution } from "@/lib/jobs/for-you/home-view";

/** Opacity-only crossfade between For you and Search — not pending/session gates. */
export function shouldAnimateJobsHomeViewSwap(
    previous: JobsHomeResolution,
    next: JobsHomeResolution,
): boolean {
    if (previous === next) return false;
    const wasResolved = previous === "for-you" || previous === "search";
    const isResolved = next === "for-you" || next === "search";
    return wasResolved && isResolved;
}
