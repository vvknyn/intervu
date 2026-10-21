import type { ReactNode } from "react";
import type { DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import {
    deckListKind,
    formatLeftOutLine,
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
 * Under a résumé-ranked list's count: the notice when the list holds the closest or the older roles, what the list left out and
 * why ("Left out of the 226 roles found: 41 above your level · ..."), and the control for the languages postings are read in.
 * Plain secondary text, in the same words everywhere a recommendation is counted (`left-out-copy.ts`).
 */
export function RecommendedListNotes({ summary, languages }: { summary: DeckLeftOutSummary; languages?: ReactNode }) {
    const notice = recommendedListNotice(summary);
    const leftOut = formatLeftOutLine(summary);
    if (!notice && !leftOut && !languages) return null;
    return (
        <div data-testid="list-notes" className="mb-3 space-y-2 px-[var(--list-inset)] text-sm text-muted-foreground">
            {notice ? (
                <p data-testid="list-notice" data-kind={deckListKind(summary)}>
                    {notice}
                </p>
            ) : null}
            {leftOut ? <p data-testid="list-left-out">{leftOut}</p> : null}
            {languages}
        </div>
    );
}
