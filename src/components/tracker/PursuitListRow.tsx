"use client";

import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import {
    daysInTracker,
    daysSinceUpdate,
    hasResumeLinked,
    isStalePursuit,
    trackerStatusColorClass,
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
                "grid w-full cursor-pointer grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-3 py-4 text-left transition-colors hover:bg-muted",
                active && "border-l-[3px] border-l-brand bg-muted",
            )}
        >
            <div className="min-w-0">
                <div className="truncate text-base font-semibold">{pursuit.position}</div>
                <div className="truncate text-sm text-muted-foreground">{pursuit.company_name}</div>
            </div>
            <span className={cn("h-fit text-sm", trackerStatusColorClass(pursuit.status))}>
                {trackerStatusLabel(pursuit.status)}
            </span>
            <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
