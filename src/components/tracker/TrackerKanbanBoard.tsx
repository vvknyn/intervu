"use client";

import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import { groupPursuitsByBoardColumn, TRACKER_BOARD_COLUMNS } from "@/lib/pursuits/tracker-display";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";

interface TrackerKanbanBoardProps {
    pursuits: Pursuit[];
    selectedId: string | null;
    detailOpen: boolean;
    onRowClick: (id: string) => void;
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
 */
export function TrackerKanbanBoard({ pursuits, selectedId, detailOpen, onRowClick }: TrackerKanbanBoardProps) {
    const groups = groupPursuitsByBoardColumn(pursuits);

    return (
        <div data-testid="tracker-kanban">
            <div className="mb-2 flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden">
                {TRACKER_BOARD_COLUMNS.map(({ column, label }) => (
                    <a
                        key={column}
                        href={`#${laneAnchor(column)}`}
                        className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border border-border px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        {label}
                        <span className="tabular-nums opacity-60">{groups[column].length}</span>
                    </a>
                ))}
            </div>
            <div
                className={cn(
                    "flex gap-3 overflow-x-auto scroll-pl-0 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    "md:grid md:grid-cols-5 md:overflow-visible md:snap-none",
                )}
            >
                {TRACKER_BOARD_COLUMNS.map(({ column, label }) => {
                    const items = groups[column];
                    return (
                        <section
                            key={column}
                            id={laneAnchor(column)}
                            aria-label={label}
                            className="flex w-[min(85vw,20rem)] shrink-0 scroll-ml-0 snap-start flex-col rounded-none border border-border bg-muted/20 md:w-auto md:min-w-0"
                        >
                            <header className="border-b border-border px-3 py-2">
                                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {label}
                                    <span className="ml-1.5 font-normal tabular-nums opacity-70">{items.length}</span>
                                </h3>
                            </header>
                            <div className="flex flex-col gap-2 p-2">
                                {items.length === 0 ? (
                                    <p className="px-1 py-2 text-xs text-muted-foreground">None</p>
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
