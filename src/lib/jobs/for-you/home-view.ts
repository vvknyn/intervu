export type JobsHomeView = "for-you" | "search";

/**
 * Resolved /jobs home. `"pending"` is a first-paint state: résumé presence
 * has not settled, and nothing in the URL forces Search. The shell must not
 * mount Search chrome in this state (that flash is the Betalist blocker).
 */
export type JobsHomeResolution = JobsHomeView | "pending";

export function resolveJobsHomeView(input: {
    urlView: "for-you" | "search" | null;
    resumeOnFile: boolean | null;
    companyDomain: string | null;
    board: string | null;
    q: string;
    sort: "newest" | "relevance" | "salary" | "fit" | null;
    /** Last non-pending home the visitor actually saw. Only `"for-you"` is
     * treated as an optimistic signal — never last Search, which re-creates
     * the Search-chrome flash for a returning user with a résumé. */
    lastHomeView?: JobsHomeView | null;
}): JobsHomeResolution {
    if (input.urlView === "search") return "search";
    if (input.companyDomain || input.board) return "search";
    if (input.q.trim() && input.sort !== "fit") return "search";

    if (input.urlView === "for-you") {
        if (input.resumeOnFile === false) return "search";
        return "for-you";
    }

    if (input.resumeOnFile === true) return "for-you";
    if (input.resumeOnFile === false) return "search";

    if (input.lastHomeView === "for-you") return "for-you";
    return "pending";
}
