"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { countNewSinceAction } from "@/actions/jobs";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { resolveVisitBannerState } from "@/lib/jobs/visit-banner";

/**
 * "Posted since your last visit" board banner — self-contained about its own
 * fetch, same posture as `FollowAlertsBell`. Honesty gate lives in
 * `resolveVisitBannerState`: a visitor with no PRIOR stored board cursor
 * never sees a "since your last visit" claim, however large the count.
 */
export function BoardVisitBanner() {
    const [count, setCount] = useState(0);
    const [state, setState] = useState<"hidden" | "shown">("hidden");
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const hadCursor = hasVisitCursor("board");
            const n = hadCursor
                ? await countNewSinceAction({ scope: "board" }, readVisitCursor("board"))
                : 0;
            // The ONE write moment: always after the read, regardless of
            // whether a cursor already existed — this plants a cursor for
            // first-time visitors too, which is what makes THEIR next visit
            // eligible. Writing before the read would clobber the value
            // just diffed against.
            writeVisitCursor("board", new Date().toISOString());
            if (cancelled) return;
            setCount(n);
            setState(resolveVisitBannerState({ hasCursor: hadCursor, count: n }));
        })();

        return () => {
            cancelled = true;
        };
        // Board scope's count is NOT filtered by the elite/all board toggle
        // (`getCachedBoardCountNew` takes no `board` param) — fetch once on
        // mount only, never re-run on filter/board state changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-dismiss toast after 6 seconds
    useEffect(() => {
        if (state === "shown" && !dismissed) {
            const timer = setTimeout(() => {
                setDismissed(true);
            }, 6000);
            return () => clearTimeout(timer);
        }
    }, [state, dismissed]);

    if (state === "hidden" || dismissed) return null;

    return (
        <div
            data-testid="board-visit-banner"
            role="status"
            aria-live="polite"
            className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center justify-between gap-3 rounded-none bg-card border border-border px-4 py-3 backdrop-saturate-180 animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
            <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-none bg-brand" aria-hidden />
                <p className="text-xs text-foreground">
                    <span className="font-semibold text-brand tabular-nums">{count}</span> new role{count === 1 ? "" : "s"} posted since your last visit
                </p>
            </div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-muted-foreground transition-colors hover:text-foreground"
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}
