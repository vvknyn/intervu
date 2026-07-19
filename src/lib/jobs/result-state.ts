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

/**
 * Task 11 — empty state's ghost-reveal line: only worth showing when ghosts
 * are currently hidden (the first-screen default) AND the honest hidden
 * count (Task 7's `ghostHiddenCount` — `null` while unresolved, or when
 * ghosts are shown) is actually positive. Extracted as a pure function
 * rather than an inline JSX condition so it's unit-testable without a React
 * harness, matching `isUnavailableJobsResult`/`resolveSelectionAfterRefresh`
 * above. Returns the count itself (not a boolean) so the caller can render
 * `{n} roles hidden as likely-ghost — show them` directly off the result.
 */
export function resolveGhostReveal(hideGhosts: boolean, ghostHiddenCount: number | null): number | null {
    if (!hideGhosts) return null;
    if (ghostHiddenCount == null || ghostHiddenCount <= 0) return null;
    return ghostHiddenCount;
}
