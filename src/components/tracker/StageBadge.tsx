"use client";

/**
 * Tracker-stage pill — the one place stage colour becomes a rendered pill.
 * design-language.md §1/§7: colour only via `st-*` tokens; §1 puts status
 * dots/pills at `rounded-pill`. Reused by the tracker list row, the
 * pursuit detail sheet, and the history row so a stage never gets a second
 * colour mapping (single source of truth) — label text still comes from
 * `trackerStatusLabel` (tracker-display.ts), the existing chokepoint for
 * "Saved" vs "Applied" vs "Rejected"/"Withdrawn" wording.
 */

import { cn } from "@/lib/utils";
import { boardColumn, type BoardColumn, type PursuitStage } from "@/lib/pursuits/types";
import { trackerStatusLabel } from "@/lib/pursuits/tracker-display";

const STAGE_PILL_CLASS: Record<BoardColumn, string> = {
    saved: "bg-st-saved-soft text-st-saved",
    applied: "bg-st-applied-soft text-st-applied",
    interviewing: "bg-st-intv-soft text-st-intv",
    offer: "bg-st-offer-soft text-st-offer",
    closed: "bg-st-closed-soft text-st-closed",
};

export function StageBadge({ status, className }: { status: PursuitStage; className?: string }) {
    const column = boardColumn({ status });
    return (
        <span
            className={cn(
                "inline-flex h-fit shrink-0 items-center rounded-pill border border-border px-2 py-0.5 text-xs font-semibold leading-none tabular-nums",
                STAGE_PILL_CLASS[column],
                className,
            )}
        >
            {trackerStatusLabel(status)}
        </span>
    );
}
