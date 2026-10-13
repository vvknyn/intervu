"use client";

import Link from "next/link";
import { isOptimisticPursuitId } from "@/lib/pursuits/optimistic-pursuit";
import { hasReachedStage, stageLabel, type Pursuit } from "@/lib/pursuits/types";
import { cn } from "@/lib/utils";

/**
 * "Applied" (or the stage past it: Interviewing, Offer…) on a role the person
 * has already applied to — this posting, or the same opening listed again
 * (`trackedPursuitFor`, lib/pursuits/applied.ts). Before 2026-10-13 a list row
 * said nothing, so an applied role read as new every time it came back
 * (review). Renders nothing for a role not applied to (a saved one keeps its
 * filled bookmark). Links to the role's tracker page when it has one.
 */
export function AppliedBadge({ pursuit, className, nowMs }: { pursuit: Pursuit | undefined; className?: string; nowMs?: number }) {
    if (!pursuit || !hasReachedStage(pursuit, "applied")) return null;
    const label = pursuit.status === "interviewing" ? "Interviewing" : stageLabel(pursuit, nowMs);
    const chip = cn(
        "mono-data inline-block rounded-pill border border-border bg-chip px-2 py-0.5 text-xs font-semibold leading-none text-foreground",
        className,
    );
    if (isOptimisticPursuitId(pursuit.id)) {
        return (
            <span data-testid="job-applied-badge" className={chip}>
                {label}
            </span>
        );
    }
    return (
        <Link
            href={`/yours/${pursuit.id}`}
            data-testid="job-applied-badge"
            aria-label={`${label} — open in your tracker`}
            onClick={(e) => e.stopPropagation()}
            className={chip}
        >
            {label}
        </Link>
    );
}
