import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

/** Display cap for anonymous return cards — "10+ new" when the count is 10 or more. */
export const NEW_SINCE_VISIT_DISPLAY_CAP = 10;

/**
 * Render a capped "N new" label for return-visit cards. Values at or above
 * {@link NEW_SINCE_VISIT_DISPLAY_CAP} print as "10+ new".
 */
export function formatNewSinceVisit(count: CorpusCount): string {
    if (count.value >= NEW_SINCE_VISIT_DISPLAY_CAP) {
        return `${NEW_SINCE_VISIT_DISPLAY_CAP}+ new`;
    }
    return `${formatCorpusCount(count)} new`;
}
