"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { countNewSinceAction } from "@/actions/jobs";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { resolveVisitBannerState } from "@/lib/jobs/visit-banner";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

const NO_COUNT: CorpusCount = { kind: "exact", value: 0 };

/**
 * "Posted since your last visit" board banner — self-contained about its own
 * fetch, same posture as `FollowAlertsBell`. Honesty gate lives in
 * `resolveVisitBannerState`: a visitor with no PRIOR stored board cursor
 * never sees a "since your last visit" claim, however large the count.
 */
export function BoardVisitBanner() {
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
            // Below lg, two OTHER fixed bars can occupy the viewport's own
            // bottom edge at the same time as this toast: the tab bar
            // (always) and, on the landing/ask view, `mobile-search-cta`
            // stacked above it — together up to `--mobile-tabbar-h +
            // --mobile-search-cta-h` tall. A flat `bottom-6` sits inside
            // that band and the toast renders fully hidden underneath them
            // (z-50 loses to the CTA's z-[180]). This component has no way
            // to know whether the CTA is showing right now, so it clears
            // the worst case unconditionally, using the SAME two tokens
            // those bars size themselves from — never a restated px guess.
            // lg+ has neither bar (both `lg:hidden`), so `lg:bottom-6`
            // restores the plain corner-toast position there.
            className="fixed bottom-[calc(var(--mobile-tabbar-h)+var(--mobile-search-cta-h)+env(safe-area-inset-bottom,0px)+1rem)] right-4 z-50 flex max-w-sm items-center justify-between gap-3 rounded-panel bg-surface border border-border px-4 py-3 animate-in fade-in slide-in-from-bottom-4 duration-300 lg:bottom-6 lg:right-6"
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
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:text-foreground"
            >
                <X aria-hidden />
            </button>
        </div>
    );
}
