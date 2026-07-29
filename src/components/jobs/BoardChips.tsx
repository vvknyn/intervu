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
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="board-chips">
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
                                "rounded-full border px-3.5 py-1.5 text-[13px] font-medium",
                                on
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border bg-background text-foreground/80 hover:border-foreground/40",
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
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
                Companies hiring hard
            </Link>
        </div>
    );
}
