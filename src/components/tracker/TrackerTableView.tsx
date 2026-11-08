"use client";

import type { BoardColumn, Pursuit } from "@/lib/pursuits/types";
import { boardColumn } from "@/lib/pursuits/types";
import { pursuitRowMetaItems, TRACKER_BOARD_COLUMNS } from "@/lib/pursuits/tracker-display";
import { StageBadge } from "@/components/tracker/StageBadge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Frame, FramePanel } from "@/components/ui/frame";
import { FactLine } from "@/components/ui/fact-line";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TrackerTableViewProps {
    pursuits: Pursuit[];
    selectedId: string | null;
    detailOpen: boolean;
    onRowClick: (id: string) => void;
    stage?: BoardColumn | null;
}

/**
 * Dense Linear/21st.dev-style tabular pipeline view for `/yours`, built on
 * `@coss/frame` + `@coss/table`. Shares `StageBadge` and `pursuitRowMetaItems`
 * with `PursuitListRow` so board and table views never disagree on wording or status tokens.
 */
export function TrackerTableView({
    pursuits,
    selectedId,
    detailOpen,
    onRowClick,
    stage = null,
}: TrackerTableViewProps) {
    const visible = stage ? pursuits.filter((p) => boardColumn(p) === stage) : pursuits;
    const stageLabel = stage ? TRACKER_BOARD_COLUMNS.find((c) => c.column === stage)?.label : null;

    return (
        <Frame data-testid="tracker-table" data-stage={stage ?? undefined}>
            <FramePanel className="overflow-hidden p-0">
                {visible.length === 0 ? (
                    <Empty className="border-0 py-8">
                        <EmptyDescription>
                            {stageLabel ? `No roles in ${stageLabel.toLowerCase()}.` : "No tracked roles."}
                        </EmptyDescription>
                    </Empty>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead>Role</TableHead>
                                <TableHead>Company</TableHead>
                                <TableHead>Stage</TableHead>
                                <TableHead className="hidden md:table-cell">Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visible.map((pursuit) => {
                                const active = selectedId === pursuit.id && detailOpen;
                                const metaItems = pursuitRowMetaItems(pursuit);
                                return (
                                    <TableRow
                                        key={pursuit.id}
                                        data-state={active ? "selected" : undefined}
                                        onClick={() => onRowClick(pursuit.id)}
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                onRowClick(pursuit.id);
                                            }
                                        }}
                                        className="cursor-pointer outline-none focus-visible:inset-outline-2 focus-visible:outline-live"
                                    >
                                        <TableCell className="font-semibold text-foreground">
                                            {pursuit.position}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {pursuit.company_name}
                                        </TableCell>
                                        <TableCell>
                                            <StageBadge status={pursuit.status} />
                                        </TableCell>
                                        <TableCell className="hidden text-muted-foreground md:table-cell">
                                            {metaItems.length > 0 ? (
                                                <FactLine items={metaItems} className="text-xs text-muted-foreground" />
                                            ) : (
                                                <span className="text-xs text-faint">—</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </FramePanel>
        </Frame>
    );
}
