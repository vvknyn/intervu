"use client";

import { cn } from "@/lib/utils";
import { DotSeparated } from "@/components/ui/dot-separated";
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
            <div className="col-span-2 text-sm text-muted-foreground">
                <DotSeparated
                    items={[
                        `${days}d in tracker`,
                        resumeLinked ? "resume linked" : "no resume",
                        stale && `no update in ${daysSinceUpdate(pursuit)}d`,
                        note,
                    ]}
                />
            </div>
        </button>
    );
}
