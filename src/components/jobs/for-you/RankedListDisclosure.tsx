"use client";

import { CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { DisclosureRow } from "@/lib/jobs/for-you/left-out-copy";
import { cn } from "@/lib/utils";

/** The id the "Ranked lower" divider in the list carries, so a row's Jump scrolls to it. */
export const RANKED_LOWER_ANCHOR = "ranked-lower";
const OPEN_KEY = "velai.ranked-disclosure.open";

const linkClass = "underline underline-offset-2 transition-colors duration-100 hover:text-foreground";

function readOpen(): boolean {
    try {
        return window.localStorage.getItem(OPEN_KEY) === "1";
    } catch {
        return false;
    }
}

function writeOpen(open: boolean): void {
    try {
        window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
        /* storage blocked: the panel just starts closed next time */
    }
}

/** The one quiet line under the count ("Showing 236 of 368 · 122 ranked lower · 54 hidden") and, opened, a row per bucket with its action. Presentational: `RankedListDisclosure` holds the open state. */
export function RankedListDisclosureView({
    line,
    rows,
    open,
    onToggle,
    onAction,
    footer,
}: {
    line: string;
    rows: readonly DisclosureRow[];
    open: boolean;
    onToggle: () => void;
    onAction: (row: DisclosureRow) => void;
    /** The last row of the panel: the languages postings are read in. */
    footer?: ReactNode;
}) {
    const action = (row: DisclosureRow): ReactNode => {
        const a = row.action;
        if (!a) return null;
        if (a.kind === "tracker")
            return (
                <Link href="/yours" className={linkClass}>
                    View in tracker
                </Link>
            );
        return (
            <button type="button" data-testid={`ranked-action-${row.key}`} onClick={() => onAction(row)} className={linkClass}>
                {a.kind === "jump" ? "Jump" : "Include"}
            </button>
        );
    };
    return (
        <div data-testid="ranked-disclosure" className="text-sm text-muted-foreground">
            <button
                type="button"
                data-testid="ranked-disclosure-toggle"
                aria-expanded={open}
                aria-controls="ranked-disclosure-panel"
                onClick={onToggle}
                className="inline-flex items-center gap-1.5 transition-colors duration-100 hover:text-foreground"
            >
                <span>{line}</span>
                <CaretDown aria-hidden className={cn("size-3 transition-transform duration-150", open && "rotate-180")} />
            </button>
            {open ? (
                <div id="ranked-disclosure-panel" data-testid="ranked-disclosure-panel" className="mt-2 space-y-1.5">
                    <ul className="space-y-1.5">
                        {rows.map((row) => (
                            <li key={row.key} data-testid={`ranked-row-${row.key}`} className="flex flex-wrap items-baseline gap-x-2">
                                <span>{row.count != null ? `${row.count.toLocaleString()} · ${row.reason}` : row.reason}</span>
                                {action(row)}
                            </li>
                        ))}
                    </ul>
                    {footer}
                </div>
            ) : null}
        </div>
    );
}

/** `RankedListDisclosureView` with its open state: closed on first paint, then what the person last chose (remembered in this browser). */
export function RankedListDisclosure(props: Omit<Parameters<typeof RankedListDisclosureView>[0], "open" | "onToggle">) {
    const [open, setOpen] = useState(false);
    useEffect(() => setOpen(readOpen()), []);
    return (
        <RankedListDisclosureView
            {...props}
            open={open}
            onToggle={() => {
                writeOpen(!open);
                setOpen(!open);
            }}
        />
    );
}
