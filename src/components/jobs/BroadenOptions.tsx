"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { chipVariants } from "@/components/ui/chip";
import { resolveBroadenOptions, type BroadenContext, type BroadenOption, type ResolveBroadenInput } from "@/lib/jobs/broaden";
import { jobsBoardHref, serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";
import { cn } from "@/lib/utils";

export interface BroadenOptionsProps extends Pick<ResolveBroadenInput, "search"> {
    /** The filters whose results are thin or empty. */
    state: JobsUrlState;
    /** Results those filters return. */
    total: number;
    ctx?: BroadenContext;
    /** Apply in place (the board). Omitted: each option links to `/jobs` with its filters (the packs). */
    onApply?: (next: JobsUrlState) => void;
    className?: string;
    testId?: string;
}

/**
 * The ONE "broaden this search" nudge — the packs' thin state and the board's
 * zero/thin state both render it, so they offer the same options with the same
 * counts. Each option shows how many results it would return (from the same
 * search call the results use); options that add nothing are not drawn.
 */
export function BroadenOptions({ state, total, ctx, search, onApply, className, testId = "broaden-options" }: BroadenOptionsProps) {
    const [options, setOptions] = useState<BroadenOption[]>([]);
    const key = `${serializeJobsUrl(state)}|${total}|${ctx?.autoLocationLabel ?? ""}|${JSON.stringify(ctx?.relocation ?? null)}`;

    useEffect(() => {
        let live = true;
        setOptions([]);
        void resolveBroadenOptions({ state, total, ctx, search }).then((next) => {
            if (live) setOptions(next);
        });
        return () => {
            live = false;
        };
        // `key` is the identity of (state, total, ctx); `search` is a stable action.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    if (options.length === 0) return null;

    return (
        <div className={cn("space-y-2", className)} data-testid={testId}>
            <p className="text-xs font-semibold text-muted-foreground">Broaden this search</p>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => {
                    const label = (
                        <>
                            {option.label}
                            <span className="text-muted-foreground">{option.count.toLocaleString()} roles</span>
                        </>
                    );
                    const cls = chipVariants({ interactive: true });
                    return onApply ? (
                        <button
                            key={option.id}
                            type="button"
                            data-testid={`broaden-${option.id}`}
                            className={cls}
                            onClick={() => onApply(option.next)}
                        >
                            {label}
                        </button>
                    ) : (
                        <Link
                            key={option.id}
                            href={jobsBoardHref(option.next)}
                            data-testid={`broaden-${option.id}`}
                            className={cls}
                        >
                            {label}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
