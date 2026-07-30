"use client";

import Link from "next/link";
import { BOARD_META, type BoardId } from "@/lib/boards/types";
import { cn } from "@/lib/utils";

const ORDER: BoardId[] = ["elite"];

export function BoardChips({
    board,
    onChange,
}: {
    board: BoardId | null;
    onChange: (next: BoardId | null) => void;
}) {
    const eliteOn = board === "elite";

    return (
        <div
            className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", eliteOn && "elite-signal")}
            data-testid="board-chips"
        >
            <div className="flex flex-wrap gap-2">
                {ORDER.map((id) => {
                    const on = board === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            data-testid={`board-chip-${id}`}
                            aria-pressed={on}
                            onClick={() => onChange(on ? null : id)}
                            className={cn(
                                on
                                    ? "elite-chip elite-chip-on"
                                    : "rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] font-medium text-foreground/80 hover:border-foreground/40",
                            )}
                        >
                            {BOARD_META[id].label}
                        </button>
                    );
                })}
            </div>
            <Link
                href="/companies/hiring"
                data-testid="hot-companies-link"
                className={cn(
                    "text-[13px] transition-colors",
                    eliteOn
                        ? "text-[color:var(--elite-muted)] hover:text-[color:var(--elite-ink)]"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                Companies hiring hard
            </Link>
        </div>
    );
}
