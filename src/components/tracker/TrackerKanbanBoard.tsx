"use client";

import Link from "next/link";
import { cn, CHROME_FOCUS_VISIBLE } from "@/lib/utils";
import type { BoardColumn, Pursuit } from "@/lib/pursuits/types";
import { groupPursuitsByBoardColumn, TRACKER_BOARD_COLUMNS } from "@/lib/pursuits/tracker-display";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";

interface TrackerKanbanBoardProps {
    pursuits: Pursuit[];
    selectedId: string | null;
    detailOpen: boolean;
    onRowClick: (id: string) => void;
    /** `/yours?stage=applied` (a number on the packs home): that lane alone, full width, with a way back to every stage. */
    stage?: BoardColumn | null;
}

const laneAnchor = (column: string) => `lane-${column}`;

/**
 * All five lanes render together, always — `TRACKER_BOARD_COLUMNS` is the
 * one place the lane list/order/labels live (chokepoint), so there's
 * nothing left to filter: every lane head already shows its own count. On
 * narrow viewports the lanes become a swipeable row (existing snap-x
 * carousel); the jump nav below is plain anchor links into that same row
 * (named pattern: anchor/jump nav) so "Closed" — previously unreachable
 * from the old chip filter, which didn't have an entry for it — is one tap
 * away without hiding the other four lanes.
 *
 * `stage` narrows it to one lane: the packs home's tracker numbers ("2
 * Applied") open exactly the applications they count.
 */
export function TrackerKanbanBoard({ pursuits, selectedId, detailOpen, onRowClick, stage = null }: TrackerKanbanBoardProps) {
    const groups = groupPursuitsByBoardColumn(pursuits);
    const lanes = stage ? TRACKER_BOARD_COLUMNS.filter(({ column }) => column === stage) : TRACKER_BOARD_COLUMNS;

    return (
        <div data-testid="tracker-kanban" data-stage={stage ?? undefined}>
            {stage ? (
                <p className="mb-3 flex flex-wrap items-baseline gap-x-3 text-sm text-muted-foreground" data-testid="tracker-stage-filter">
                    <span>Showing {lanes[0]?.label} only</span>
                    <Link href="/yours" data-testid="tracker-stage-all" className="text-brand hover:underline">
                        All stages
                    </Link>
                </p>
            ) : null}
            <div
                data-testid="tracker-stage-rail"
                className={cn(
                    "mb-2 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden",
                    stage && "hidden",
                )}
            >
                {TRACKER_BOARD_COLUMNS.map(({ column, label }) => (
                    <a
                        key={column}
                        href={`#${laneAnchor(column)}`}
                        className={cn(
                            "flex h-11 min-h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-pill border border-border bg-surface-2 px-3 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-bevel-highlight)]",
                            CHROME_FOCUS_VISIBLE,
                        )}
                    >
                        {label}
                        <span className="tabular-nums opacity-60">{groups[column].length}</span>
                    </a>
                ))}
            </div>
            <div
                className={cn(
                    "flex gap-3 overflow-x-auto scroll-pl-0 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    stage ? "flex-col" : "md:grid md:grid-cols-5 md:overflow-visible md:snap-none",
                )}
            >
                {lanes.map(({ column, label }) => {
                    const items = groups[column];
                    return (
                        <section
                            key={column}
                            id={laneAnchor(column)}
                            aria-label={label}
                            className={cn(
                                "flex shrink-0 scroll-ml-0 snap-start flex-col rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]",
                                stage ? "w-full" : "w-80 md:w-auto md:min-w-0",
                            )}
                        >
                            <header className="border-b border-border px-[var(--list-inset)] py-2">
                                <h3 className="text-sm text-muted-foreground">
                                    {label}
                                    <span className="ml-2 font-semibold text-foreground tabular-nums">{items.length}</span>
                                </h3>
                            </header>
                            <div className="flex flex-col divide-y divide-border">
                                {items.length === 0 ? (
                                    <p className="px-3 py-4 text-xs text-muted-foreground">None</p>
                                ) : (
                                    items.map((p) => (
                                        <PursuitListRow
                                            key={p.id}
                                            pursuit={p}
                                            active={selectedId === p.id && detailOpen}
                                            onClick={() => onRowClick(p.id)}
                                        />
                                    ))
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
