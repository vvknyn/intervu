"use client";

import { useEffect, useState } from "react";
import { countNewSinceAction } from "@/actions/jobs";
import { hasVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { resolveVisitBannerState, visitBannerFitsResults } from "@/lib/jobs/visit-banner";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

const NO_COUNT: CorpusCount = { kind: "exact", value: 0 };

type VisitRead = { hadCursor: boolean; count: CorpusCount };

/**
 * One read per page load. The list remounts this line when a search's results
 * arrive, and a second read would diff against the cursor the first one just
 * wrote (0 new, so the line vanished on every searched list). Every later
 * mount reuses the first answer; a failed read is forgotten so a later mount
 * can try again.
 */
let visitRead: Promise<VisitRead> | null = null;

function readVisitOnce(): Promise<VisitRead> {
    visitRead ??= (async () => {
        const hadCursor = hasVisitCursor("board");
        const count = hadCursor ? await countNewSinceAction({ scope: "board" }, readVisitCursor("board")) : NO_COUNT;
        // The ONE write moment: always after the read, regardless of
        // whether a cursor already existed — this plants a cursor for
        // first-time visitors too, which is what makes THEIR next visit
        // eligible. Writing before the read would clobber the value
        // just diffed against.
        writeVisitCursor("board", new Date().toISOString());
        return { hadCursor, count };
    })().catch((error: unknown) => {
        visitRead = null;
        throw error;
    });
    return visitRead;
}

/**
 * "New roles since your last visit" — one quiet line at the top of the list
 * panel, self-contained about its own fetch (same posture as
 * `FollowAlertsBell`). It used to be a corner toast that dismissed itself
 * after six seconds, so the one reason to come back was gone before most
 * people read it; now it stays for the whole visit. Its "Email me new roles"
 * link is gone (2026-10-10): the results line's "Job alert" switch
 * just below it is the one alerts control.
 *
 * Honesty gate lives in `resolveVisitBannerState`: a visitor with no PRIOR
 * stored board cursor never sees a "since your last visit" claim, however
 * large the count. The count is corpus-wide (the board scope takes no
 * filters), so the copy says "on Velai" rather than implying the rows below.
 */
export function BoardVisitBanner({
    resultCount,
}: {
    /** Rows the page is showing right now — a zero or thin state hides the line. */
    resultCount: number;
}) {
    const [count, setCount] = useState<CorpusCount>(NO_COUNT);
    const [state, setState] = useState<"hidden" | "shown">("hidden");

    useEffect(() => {
        let cancelled = false;

        readVisitOnce().then(
            ({ hadCursor, count: n }) => {
                if (cancelled) return;
                setCount(n);
                setState(resolveVisitBannerState({ hasCursor: hadCursor, count: n }));
            },
            () => {},
        );

        return () => {
            cancelled = true;
        };
        // Board scope's count is NOT filtered by the elite/all board toggle
        // (`getCachedBoardCountNew` takes no `board` param) — fetch once on
        // mount only, never re-run on filter/board state changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (state !== "shown" || !visitBannerFitsResults(resultCount)) return null;

    return (
        <div
            data-testid="board-visit-banner"
            className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4 pb-2 text-sm text-muted-foreground"
        >
            <p role="status" className="inline-flex items-baseline gap-2">
                <span className="size-2 shrink-0 self-center rounded-pill bg-brand" aria-hidden />
                <span>
                    <span data-testid="board-visit-count" className="font-semibold text-foreground tabular-nums">
                        {formatCorpusCount(count)}
                    </span>{" "}
                    new role{count.value === 1 ? "" : "s"} on Velai since your last visit
                </span>
            </p>
        </div>
    );
}
