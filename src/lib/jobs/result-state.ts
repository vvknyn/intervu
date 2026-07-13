import type { JobSearchResult, PublicJob } from "./types";

/**
 * The dispatcher returns configured backend failures as an empty result with
 * an unavailable note. Keep that state distinct from a successful empty query.
 * Existing hits are never considered unavailable so background refresh errors
 * can leave the current list visible.
 */
export function isUnavailableJobsResult(result: JobSearchResult): boolean {
    return (
        result.configured &&
        result.hits.length === 0 &&
        /temporarily unavailable/i.test(result.note ?? "")
    );
}

export interface SelectionAfterRefresh {
    selectedId: string | null;
    /**
     * True only when the previously displayed job still exists. If it does
     * not, mobile closes the sheet instead of silently swapping its contents.
     */
    preserveDeliberateDetail: boolean;
}

export function resolveSelectionAfterRefresh(
    previousSelectedId: string | null,
    hits: Pick<PublicJob, "id">[],
): SelectionAfterRefresh {
    if (previousSelectedId && hits.some((hit) => hit.id === previousSelectedId)) {
        return {
            selectedId: previousSelectedId,
            preserveDeliberateDetail: true,
        };
    }
    return {
        selectedId: hits[0]?.id ?? null,
        preserveDeliberateDetail: false,
    };
}
