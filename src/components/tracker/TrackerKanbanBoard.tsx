"use client";

import { cn } from "@/lib/utils";
import type { Pursuit } from "@/lib/pursuits/types";
import {
    groupPursuitsByBoardColumn,
    TRACKER_BOARD_COLUMNS,
    visibleTrackerBoardColumns,
    type TrackerFilter,
} from "@/lib/pursuits/tracker-display";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";

interface TrackerKanbanBoardProps {
    pursuits: Pursuit[];
    filter: TrackerFilter;
    selectedId: string | null;
    detailOpen: boolean;
    onRowClick: (id: string) => void;
}

const GRID_COLS: Record<number, string> = {
    1: "md:grid-cols-1",
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-4",
    5: "md:grid-cols-5",
};

export function TrackerKanbanBoard({
    pursuits,
    filter,
    selectedId,
    detailOpen,
    onRowClick,
}: TrackerKanbanBoardProps) {
    const visibleColumns = visibleTrackerBoardColumns(filter);
    const groups = groupPursuitsByBoardColumn(pursuits);
    const labels = Object.fromEntries(TRACKER_BOARD_COLUMNS.map(({ column, label }) => [column, label]));

    return (
        <div
            data-testid="tracker-kanban"
            className={cn("hidden gap-3 md:grid", GRID_COLS[visibleColumns.length] ?? "md:grid-cols-5")}
        >
            {visibleColumns.map((column) => {
                const items = groups[column];
                return (
                    <section
                        key={column}
                        aria-label={labels[column]}
                        className="flex min-w-0 flex-col rounded-none border border-border bg-muted/20"
                    >
                        <header className="border-b border-border px-3 py-2">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {labels[column]}
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
    );
}
