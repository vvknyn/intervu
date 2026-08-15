"use client";

import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import {
    daysInTracker,
    daysSinceUpdate,
    hasResumeLinked,
    isStalePursuit,
    trackerStatusBadgeClass,
    trackerStatusLabel,
} from "@/lib/pursuits/tracker-display";

interface PursuitListRowProps {
    pursuit: Pursuit;
    active?: boolean;
    onClick: () => void;
}

export function PursuitListRow({ pursuit, active, onClick }: PursuitListRowProps) {
    const days = daysInTracker(pursuit);
    const resumeLinked = hasResumeLinked(pursuit);
    const note = pursuit.note?.trim();
    const stale = isStalePursuit(pursuit);

    return (
        <button
            type="button"
            data-testid="pursuit-row"
            onClick={onClick}
            className={cn(
                "grid w-full cursor-pointer grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-[14px] border border-border bg-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[#a8b2bf] hover:shadow-[0_8px_24px_rgba(18,21,26,0.05)]",
                active && "border-foreground shadow-[0_0_0_1px_rgb(var(--foreground))]",
            )}
        >
            <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold tracking-[-0.02em]">{pursuit.position}</div>
                <div className="truncate text-[13px] text-muted-foreground">{pursuit.company_name}</div>
            </div>
            <span
                className={cn(
                    "inline-flex h-fit items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground",
                    trackerStatusBadgeClass(pursuit.status),
                )}
            >
                {trackerStatusLabel(pursuit.status)}
            </span>
            <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#8b939e]">
                <span>{days}d in tracker</span>
                <span aria-hidden="true">·</span>
                <span>{resumeLinked ? "resume linked" : "no resume"}</span>
                {stale && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span>no update in {daysSinceUpdate(pursuit)}d</span>
                    </>
                )}
                {note && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{note}</span>
                    </>
                )}
            </div>
        </button>
    );
}
