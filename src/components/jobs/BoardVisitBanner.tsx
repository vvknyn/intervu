"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { countNewSinceAction } from "@/actions/jobs";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { resolveVisitBannerState, visitBannerFitsResults } from "@/lib/jobs/visit-banner";
import { cn } from "@/lib/utils";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

const NO_COUNT: CorpusCount = { kind: "exact", value: 0 };

/**
 * "Posted since your last visit" board banner — self-contained about its own
 * fetch, same posture as `FollowAlertsBell`. Honesty gate lives in
 * `resolveVisitBannerState`: a visitor with no PRIOR stored board cursor
 * never sees a "since your last visit" claim, however large the count.
 */
export function BoardVisitBanner({
    resultCount,
    aboveMobileCta,
}: {
    /** Rows the page is showing right now — a zero or thin state hides the toast. */
    resultCount: number;
    /** Whether the page's fixed mobile search bar is up; the toast docks above it. */
    aboveMobileCta: boolean;
}) {
    const [count, setCount] = useState<CorpusCount>(NO_COUNT);
    const [state, setState] = useState<"hidden" | "shown">("hidden");
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const hadCursor = hasVisitCursor("board");
            const n = hadCursor
                ? await countNewSinceAction({ scope: "board" }, readVisitCursor("board"))
                : NO_COUNT;
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

    const visible = state === "shown" && !dismissed && visitBannerFitsResults(resultCount);

    // Auto-dismiss toast after 6 seconds, counted from when it is on screen
    useEffect(() => {
        if (visible) {
            const timer = setTimeout(() => {
                setDismissed(true);
            }, 6000);
            return () => clearTimeout(timer);
        }
    }, [visible]);

    if (!visible) return null;

    return (
        <div
            data-testid="board-visit-banner"
            role="status"
            aria-live="polite"
            // Below lg the tab bar always occupies the viewport's bottom edge
            // and, when `aboveMobileCta`, the page's fixed search bar sits on
            // top of it — the toast docks above whichever are up, reading the
            // same tokens those bars size themselves from (the global
            // Toaster's dock is the tab-bar-only case). lg+ has neither bar,
            // so `lg:bottom-6` restores the plain corner-toast position.
            className={cn(
                aboveMobileCta
                    ? "bottom-[calc(var(--mobile-tabbar-h)+var(--mobile-search-cta-h)+env(safe-area-inset-bottom,0px)+1rem)]"
                    : "bottom-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px)+1rem)]",
                "fixed right-4 z-50 flex max-w-sm items-center justify-between gap-3 rounded-panel bg-surface border border-border px-4 py-3 animate-in fade-in slide-in-from-bottom-4 duration-300 lg:bottom-6 lg:right-6",
            )}
        >
            <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-pill bg-brand" aria-hidden />
                <p className="text-xs text-foreground">
                    <span className="font-semibold text-brand tabular-nums">{formatCorpusCount(count)}</span> new role{count.value === 1 ? "" : "s"} posted since your last visit
                </p>
            </div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="ctl-sm flex ctl-square shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:text-foreground"
            >
                <X aria-hidden />
            </button>
        </div>
    );
}
