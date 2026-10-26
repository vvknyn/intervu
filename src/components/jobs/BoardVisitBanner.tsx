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
 * "565 new since your last visit": the quiet suffix of the results line, beside its count ("712 roles from the last 90
 * days · updated 3h ago · 565 new since your last visit"), so the list head states one count. It used to be a line of
 * its own above the results line, which gave the list two counts stacked. Its "Email me new roles" link is gone
 * (2026-10-10): the results line's "Job alert" switch is the one alerts control.
 *
 * Honesty gate lives in `resolveVisitBannerState`: a visitor with no PRIOR
 * stored board cursor never sees a "since your last visit" claim, however
 * large the count. The count is corpus-wide (the board scope takes no
 * filters), so it is a suffix that does not read as a count of the rows below.
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

    return <VisitSince count={count} />;
}

/** The suffix itself: a separator dot, then "565 new since your last visit". */
export function VisitSince({ count }: { count: CorpusCount }) {
    // Phone width has no room beside the count: the suffix goes rather than wrap under it (a lone dot at line end).
    return (
        <span className="hidden items-center gap-2 sm:flex">
            <span aria-hidden>·</span>
            <span data-testid="board-visit-banner" role="status">
                <span data-testid="board-visit-count" className="tabular-nums">
                    {formatCorpusCount(count)}
                </span>{" "}
                new since your last visit
            </span>
        </span>
    );
}
