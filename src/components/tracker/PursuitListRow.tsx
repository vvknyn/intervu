"use client";

import { cn } from "@/lib/utils";
import { DotSeparated } from "@/components/ui/dot-separated";
import type { Pursuit } from "@/lib/pursuits/types";
import { daysInTracker, daysSinceUpdate, hasResumeLinked, isStalePursuit } from "@/lib/pursuits/tracker-display";
import { StageBadge } from "@/components/tracker/StageBadge";

interface PursuitListRowProps {
    pursuit: Pursuit;
    active?: boolean;
    onClick: () => void;
}

/** design-language.md §4 row anatomy, no leading tile (tracker rows have no
 *  avatar/logo column, so the outer grid-cols-[auto_minmax] split collapses
 *  to a single content column) — selected/hover both read `bg-muted` only
 *  (§2: "selected = hover tint, nothing else"), no brand-colored edge. */
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
                "grid w-full cursor-pointer rounded-none bg-card px-[var(--list-inset)] pt-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                active && "bg-muted",
            )}
        >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-4">
                <div className="min-w-0">
                    <div className="truncate text-base font-semibold leading-snug text-foreground">{pursuit.position}</div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">{pursuit.company_name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                        <DotSeparated
                            items={[
                                `${days}d in tracker`,
                                resumeLinked ? "resume linked" : "no resume",
                                stale && `no update in ${daysSinceUpdate(pursuit)}d`,
                                note,
                            ]}
                        />
                    </div>
                </div>
                <StageBadge status={pursuit.status} className="self-start" />
            </div>
        </button>
    );
}
