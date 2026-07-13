import type { JobSearchResult } from "./types";

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
