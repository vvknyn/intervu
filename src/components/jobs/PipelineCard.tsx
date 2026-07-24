"use client";

import Link from "next/link";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { boardColumn, orderPursuits, type BoardColumn, type Pursuit } from "@/lib/pursuits/types";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { applicationStatusTone } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";

/** Dot color for a pursuit row, keyed by the same `StatusTone` vocabulary
 *  `applicationStatusTone` already resolves stage → tone with — this just
 *  adds the "plain dot" rendering `STATUS_PILL`/`STATUS_ICON_CHIP` don't. */
const DOT_CLASS: Record<ReturnType<typeof applicationStatusTone>, string> = {
    saved: "bg-st-saved",
    applied: "bg-st-applied",
    intv: "bg-st-intv",
    offer: "bg-st-offer",
    closed: "bg-st-closed",
};

/** Same stage buckets as the /yours board (`boardColumn`, single source of
 *  truth) — this card just shows a subset (no "closed" tile) and its own labels. */
const STAGE_TILES: { label: string; column: BoardColumn }[] = [
    { label: "Saved", column: "saved" },
    { label: "Applied", column: "applied" },
    { label: "Interview", column: "interviewing" },
    { label: "Offer", column: "offer" },
];

function pursuitTitle(p: Pursuit): string {
    return p.job_snapshot?.title ?? p.position;
}
function pursuitCompany(p: Pursuit): string {
    return p.job_snapshot?.company ?? p.company_name;
}

/**
 * Real, timestamp-derived status line for one pipeline row. Deliberately
 * carries no "listing went inactive" / "role still live" claim (the mock's
 * fake copy) — no such detection exists (spec: "no invented data").
 */
function statusLine(p: Pursuit, nowMs: number): string {
    switch (p.status) {
        case "interested":
            return `saved ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "resume_ready":
            return `resume ready ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "applied":
            return `applied ${formatRelativeAge(p.applied_at ?? p.updated_at, nowMs)}`;
        case "interviewing":
            return p.interview_date
                ? `interview ${formatRelativeAge(p.interview_date, nowMs)}`
                : `interviewing · updated ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "offer":
            return `offer ${formatRelativeAge(p.updated_at, nowMs)}`;
        case "rejected":
        case "withdrawn":
            return `closed ${formatRelativeAge(p.updated_at, nowMs)}`;
    }
}

/**
 * Sidebar "Your pipeline" card (find-jobs page). Reads `usePursuits()`
 * directly — the same shared, guest-aware hook the page and TopBar already
 * use — rather than taking pursuits as a prop, so this card needs no wiring
 * beyond `nowMs` and renders identically for signed-in and guest visitors.
 */
export function PipelineCard({ nowMs }: { nowMs: number }) {
    const { pursuits } = usePursuits();
    const ordered = orderPursuits(pursuits).slice(0, 3);

    return (
        <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-baseline justify-between">
                <span className="font-display text-base font-semibold">Your pipeline</span>
                <Link href="/yours" className="text-xs font-medium text-brand hover:underline">
                    Open tracker →
                </Link>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-1.5">
                {STAGE_TILES.map((tile) => {
                    const count = pursuits.filter((p) => boardColumn(p) === tile.column).length;
                    const active = count > 0;
                    return (
                        <div
                            key={tile.label}
                            className={cn(
                                "rounded-lg px-1 py-2.5 text-center",
                                active ? "border border-green-tint-border bg-green-tint-bg" : "bg-chip",
                            )}
                        >
                            <div className={cn("font-display text-xl font-bold", active ? "text-brand" : "text-faint")}>
                                {count}
                            </div>
                            <div
                                className={cn(
                                    "mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                                    active ? "text-brand" : "text-faint",
                                )}
                            >
                                {tile.label}
                            </div>
                        </div>
                    );
                })}
            </div>
            {ordered.length > 0 ? (
                <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                    {ordered.map((p) => (
                        <Link
                            key={p.id}
                            href={`/yours/${p.id}`}
                            className="-mx-1 flex items-center gap-2.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/50"
                        >
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    DOT_CLASS[applicationStatusTone(p.status)],
                                )}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium">
                                    {pursuitTitle(p)} · {pursuitCompany(p)}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                    {statusLine(p, nowMs)}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            ) : (
                <p className="border-t border-border pt-3 text-[13px] text-muted-foreground">
                    Nothing saved yet — tap ♡ on a match to start your pipeline.
                </p>
            )}
        </div>
    );
}
