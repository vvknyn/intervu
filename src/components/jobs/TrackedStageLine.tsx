"use client";

import Link from "next/link";
import { DotSeparated } from "@/components/ui/dot-separated";
import { isOptimisticPursuitId } from "@/lib/pursuits/optimistic-pursuit";
import { boardTimestampLabel, stageLabel, type Pursuit } from "@/lib/pursuits/types";
import { cn } from "@/lib/utils";

/**
 * Where this role stands in the visitor's tracker, under the job's actions:
 * "In your tracker: Applied · applied 2d ago · Update status". The filled
 * bookmark alone said "Saved" at every stage, so after "Yes, I applied" the
 * job page gave no sign of it. Changing the stage stays on the role's own
 * tracker page (/yours/[id]); this line only links there. An optimistic row
 * (the save is still in flight) has no page yet, so it shows no link.
 */
export function TrackedStageLine({
    pursuit,
    nowMs,
    className,
}: {
    pursuit: Pursuit | undefined;
    nowMs: number;
    className?: string;
}) {
    if (!pursuit) return null;
    const linkable = !isOptimisticPursuitId(pursuit.id);
    return (
        <p data-testid="job-tracked-stage" className={cn("text-meta text-muted-foreground", className)}>
            <DotSeparated
                items={[
                    <span key="stage">
                        In your tracker: <span className="font-semibold text-foreground">{stageLabel(pursuit, nowMs)}</span>
                    </span>,
                    <span key="when" className="whitespace-nowrap">{boardTimestampLabel(pursuit, nowMs)}</span>,
                    linkable && (
                        <Link
                            key="open"
                            href={`/yours/${pursuit.id}`}
                            data-testid="job-tracked-stage-link"
                            className="whitespace-nowrap text-foreground underline underline-offset-2"
                        >
                            Update status
                        </Link>
                    ),
                ]}
            />
        </p>
    );
}
