"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { countNewSinceAction } from "@/actions/jobs";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { resolveVisitBannerState } from "@/lib/jobs/visit-banner";

/**
 * "Posted since your last visit" board banner — self-contained about its own
 * fetch, same posture as `FollowAlertsCard`. Honesty gate lives in
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

    if (state === "hidden" || dismissed) return null;

    return (
        <div
            data-testid="board-visit-banner"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-300/80 bg-card px-4 py-3 shadow-2xs dark:border-slate-700"
        >
            <p className="font-mono text-[12.5px] font-medium text-muted-foreground">
                <span className="font-bold text-foreground">{count}</span> role{count === 1 ? "" : "s"} posted since your last visit
            </p>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-foreground"
            >
                <X size={16} aria-hidden />
            </button>
        </div>
    );
}
