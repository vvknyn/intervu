export type JobsHomeView = "for-you" | "search";

export function resolveJobsHomeView(input: {
    urlView: "for-you" | "search" | null;
    resumeOnFile: boolean | null;
    companyDomain: string | null;
    board: string | null;
    q: string;
    sort: "newest" | "relevance" | "salary" | "fit" | null;
}): JobsHomeView {
    if (input.urlView === "search") return "search";
    if (input.urlView === "for-you") {
        return input.resumeOnFile === true ? "for-you" : "search";
    }
    if (input.companyDomain || input.board) return "search";
    if (input.q.trim() && input.sort !== "fit") return "search";
    if (input.resumeOnFile === true) return "for-you";
    return "search";
}
