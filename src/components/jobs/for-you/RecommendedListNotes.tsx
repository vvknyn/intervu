import Link from "next/link";
import type { ReactNode } from "react";
import { RankedListDisclosure } from "@/components/jobs/for-you/RankedListDisclosure";
import type { DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import {
    deckListKind,
    disclosureRows,
    formatLeftOutCount,
    type DisclosureRow,
    listNoticeLine,
} from "@/lib/jobs/for-you/left-out-copy";

/**
 * Under a résumé-ranked list's count: the one-line notice when the list holds the closest or the older roles, and one quiet line
 * about the roles the rules cut ("54 left out") that opens to a row per bucket with its action and,
 * last, the control for the languages postings are read in (`left-out-copy.ts` words every surface).
 */
export function RecommendedListNotes({
    summary,
    languages,
    employers,
    onInclude,
}: {
    summary: DeckLeftOutSummary;
    /** The languages control; inside the opened line when there is one, else on its own. */
    languages?: ReactNode;
    employers?: number;
    /** Brings back the roles a row names (`DisclosureRow.action` "include"). */
    onInclude: (row: DisclosureRow) => void;
}) {
    const kind = deckListKind(summary);
    const notice = listNoticeLine(kind);
    const line = formatLeftOutCount(summary);
    if (!notice && !line && !languages) return null;
    const rows = disclosureRows(summary, employers);
    const act = (row: DisclosureRow) => {
        if (row.action?.kind === "include") onInclude(row);
    };
    return (
        <div data-testid="list-notes" className="mb-3 space-y-2 px-[var(--list-inset)] text-sm text-muted-foreground">
            {notice ? (
                <p data-testid="list-notice" data-kind={kind}>
                    {notice.text}
                    {notice.action ? (
                        <>
                            {" · "}
                            <Link href={notice.action.href} className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground">
                                {notice.action.label}
                            </Link>
                        </>
                    ) : null}
                </p>
            ) : null}
            {line ? <RankedListDisclosure line={line} rows={rows} onAction={act} footer={languages} /> : languages}
        </div>
    );
}
