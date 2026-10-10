"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Minus, Warning } from "@phosphor-icons/react";
import { postingCheckChipLabel, type GhostSignal } from "@/components/jobs/job-detail-facts";
import { LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";

/**
 * The posting check as a row of chips, with the full lines one tap away
 * (Vivek, 2026-10-10: "so much of our app is text"). Each chip is one signal
 * in a few words; its whole line, the explanation and how the check works
 * sit in the details below, which `children` carries. Shared by the /jobs
 * pane and sheet (JobDetail.tsx) and the job page (JobDetailDocument.tsx),
 * so both read the same.
 */
export function PostingCheckSummary({
    signals,
    relisted,
    children,
}: {
    signals: readonly GhostSignal[];
    /** The freshness line is a refreshed date (warning tone). */
    relisted: boolean;
    /** The full check: every line with its basis. */
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const chips = signals.flatMap((signal) => {
        const caution = signal.kind === "freshness" && relisted;
        const label = postingCheckChipLabel(signal, caution);
        return label ? [{ signal, label, caution }] : [];
    });

    return (
        <div className="pt-3">
            <div className="flex flex-wrap items-center gap-2">
                {chips.length > 0 && (
                    <ul data-testid="posting-check-chips" aria-label="Posting check signals" className="flex flex-wrap items-center gap-2">
                        {chips.map(({ signal, label, caution }) => (
                            <li
                                key={signal.kind}
                                title={signal.text}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs",
                                    caution
                                        ? cn("border-border", LISTING_STATE_TEXT.relisted)
                                        : signal.status === "favorable"
                                          ? "border-live-tint-border bg-live-tint-bg text-verdict-good"
                                          : "border-border text-muted-foreground",
                                )}
                            >
                                {caution ? (
                                    <Warning weight="bold" aria-hidden />
                                ) : signal.status === "favorable" ? (
                                    <Check weight="bold" aria-hidden />
                                ) : signal.status === "unfavorable" ? (
                                    <Minus weight="bold" aria-hidden />
                                ) : null}
                                {label}
                            </li>
                        ))}
                    </ul>
                )}
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={id}
                    onClick={() => setOpen((v) => !v)}
                    className="text-xs text-brand hover:underline"
                >
                    {open ? "Hide details" : "Show details"}
                </button>
            </div>
            <div id={id} data-testid="posting-check-details" className={open ? "block" : "hidden"}>
                {children}
            </div>
        </div>
    );
}
