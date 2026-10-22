"use client";

import { useState } from "react";
import Link from "next/link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { BoardColumn, Pursuit } from "@/lib/pursuits/types";
import { groupPursuitsByBoardColumn, TRACKER_BOARD_COLUMNS, trackerBoardLayout, trackerLanesToRender } from "@/lib/pursuits/tracker-display";
import { TabItem, TabNav } from "@/components/ui/tabs";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";

interface TrackerKanbanBoardProps {
    pursuits: Pursuit[];
    selectedId: string | null;
    detailOpen: boolean;
    onRowClick: (id: string) => void;
    /** `/yours?stage=applied` (a number on the packs home): that lane alone, full width, with a way back to every stage. */
    stage?: BoardColumn | null;
}

/**
 * One list, two views (`trackerBoardLayout`): md+ renders all five lanes side
 * by side; phones render a tab per lane (Saved / Applied / Interviewing /
 * Offer / Closed) showing the active lane's same cards. `TRACKER_BOARD_COLUMNS`
 * is the one place the lane list/order/labels live.
 *
 * `stage` narrows it to one lane: the packs home's tracker numbers ("2
 * Applied") open exactly the applications they count.
 */
export function TrackerKanbanBoard({ pursuits, selectedId, detailOpen, onRowClick, stage = null }: TrackerKanbanBoardProps) {
    const groups = groupPursuitsByBoardColumn(pursuits);
    const layout = trackerBoardLayout(useMediaQuery("(min-width: 768px)"));
    const [activeTab, setActiveTab] = useState<BoardColumn>(TRACKER_BOARD_COLUMNS[0].column);
    const shown = trackerLanesToRender(layout, stage, activeTab);
    const lanes = TRACKER_BOARD_COLUMNS.filter(({ column }) => shown.includes(column));

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
            <TabNav
                aria-label="Tracker stages"
                data-testid="tracker-stage-rail"
                className={cn("mb-2 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden", stage && "hidden")}
            >
                {TRACKER_BOARD_COLUMNS.map(({ column, label }) => (
                    <TabItem key={column} current={activeTab === column} onClick={() => setActiveTab(column)}>
                        {label}
                        <span className="tabular-nums opacity-60">{groups[column].length}</span>
                    </TabItem>
                ))}
            </TabNav>
            <div
                className={cn(
                    "flex gap-3 overflow-x-auto scroll-pl-0 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    stage || layout === "tabs" ? "flex-col" : "md:grid md:grid-cols-5 md:overflow-visible md:snap-none",
                )}
            >
                {lanes.map(({ column, label }) => {
                    const items = groups[column];
                    return (
                        <section
                            key={column}
                            aria-label={label}
                            className={cn(
                                "flex shrink-0 scroll-ml-0 snap-start flex-col rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]",
                                stage || layout === "tabs" ? "w-full" : "md:w-auto md:min-w-0",
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
