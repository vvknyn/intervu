import type { ReactNode } from "react";
import { RANKED_LOWER_ANCHOR, RankedListDisclosure } from "@/components/jobs/for-you/RankedListDisclosure";
import type { DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import {
    deckListKind,
    disclosureRows,
    formatRankedLine,
    type DisclosureRow,
    NEAR_MISS_NOTICE,
    OLDER_FITS_NOTICE,
    OLDER_NEAR_MISS_NOTICE,
} from "@/lib/jobs/for-you/left-out-copy";

/** What is said above the closest or the older roles when nothing newer fits (`deckListKind`); nothing for a list of roles that fit. */
export function recommendedListNotice(summary: DeckLeftOutSummary): string | null {
    const kind = deckListKind(summary);
    if (kind === "near") return NEAR_MISS_NOTICE;
    if (kind === "older") return OLDER_FITS_NOTICE;
    if (kind === "older-near") return OLDER_NEAR_MISS_NOTICE;
    return null;
}

/**
 * Under a résumé-ranked list's count: the notice when the list holds the closest or the older roles, and one quiet line
 * about the rest ("Showing 236 of 368 · 122 ranked lower · 54 hidden") that opens to a row per bucket with its action and,
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
    const notice = recommendedListNotice(summary);
    const line = formatRankedLine(summary);
    if (!notice && !line && !languages) return null;
    const rows = disclosureRows(summary, employers);
    const act = (row: DisclosureRow) => {
        if (row.action?.kind === "jump") document.getElementById(RANKED_LOWER_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
        else if (row.action?.kind === "include") onInclude(row);
    };
    return (
        <div data-testid="list-notes" className="mb-3 space-y-2 px-[var(--list-inset)] text-sm text-muted-foreground">
            {notice ? (
                <p data-testid="list-notice" data-kind={deckListKind(summary)}>
                    {notice}
                </p>
            ) : null}
            {line ? <RankedListDisclosure line={line} rows={rows} onAction={act} footer={languages} /> : languages}
        </div>
    );
}
