/**
 * Pure display/filter helpers for the /yours tracker list — single source
 * for chip filters, search, and row meta so the page and sheets stay aligned.
 */

import { boardColumn, type Pursuit, type PursuitStage } from "./types";

export type TrackerFilter = "all" | "saved" | "applied" | "interviewing" | "offer";

export const TRACKER_CHIP_FILTERS: { key: TrackerFilter; label: string }[] = [
    { key: "all", label: "all" },
    { key: "saved", label: "saved" },
    { key: "applied", label: "applied" },
    { key: "interviewing", label: "interviewing" },
    { key: "offer", label: "offers" },
];

/** Detail sheet + add form — maps UI "saved" to pursuit stage. */
export const TRACKER_DETAIL_STAGES: { stage: PursuitStage; label: string }[] = [
    { stage: "interested", label: "Saved" },
    { stage: "applied", label: "Applied" },
    { stage: "interviewing", label: "Interviewing" },
    { stage: "offer", label: "Offer" },
    { stage: "rejected", label: "Rejected" },
    { stage: "withdrawn", label: "Withdrawn" },
];

export const TRACKER_ADD_STAGES: { stage: PursuitStage; label: string }[] = [
    { stage: "interested", label: "Saved" },
    { stage: "applied", label: "Applied" },
    { stage: "interviewing", label: "Interviewing" },
    { stage: "offer", label: "Offer" },
];

export function trackerStatusLabel(status: PursuitStage): string {
    if (status === "interested" || status === "resume_ready") return "Saved";
    if (status === "rejected") return "Rejected";
    if (status === "withdrawn") return "Withdrawn";
    return status.charAt(0).toUpperCase() + status.slice(1);
}

export function trackerStatusBadgeClass(status: PursuitStage): string {
    switch (status) {
        case "interested":
        case "resume_ready":
            return "bg-[#eef2f7]";
        case "applied":
            return "border-[#c5e0c3] bg-[var(--green-soft,#e8f3e7)] text-[#3d6e3b]";
        case "interviewing":
            return "border-[#c9cef0] bg-[#eef0ff] text-[#3d457a]";
        case "offer":
            return "border-[#ddd2b8] bg-[#f3efe6] text-[#6a5528]";
        case "rejected":
        case "withdrawn":
            return "bg-[#f3f3f3] text-[#888]";
        default:
            return "";
    }
}

export function matchesTrackerFilter(p: Pursuit, filter: TrackerFilter): boolean {
    if (filter === "all") return true;
    if (filter === "saved") return boardColumn(p) === "saved";
    if (filter === "applied") return p.status === "applied";
    if (filter === "interviewing") return p.status === "interviewing";
    if (filter === "offer") return p.status === "offer";
    return true;
}

export function matchesTrackerSearch(p: Pursuit, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${p.company_name} ${p.position}`.toLowerCase().includes(q);
}

/** Bottom offset for fixed sheets so they sit above MobileTabBar on small screens. */
export const TRACKER_SHEET_BOTTOM =
    "bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px))] lg:bottom-0";

export function daysInTracker(p: Pursuit, nowMs: number = Date.now()): number {
    const created = Date.parse(p.created_at);
    if (Number.isNaN(created)) return 0;
    return Math.max(0, Math.floor((nowMs - created) / 86_400_000));
}

export function hasResumeLinked(p: Pursuit): boolean {
    return (
        (p.resume_versions?.length ?? 0) > 0 ||
        !!p.resume_version_id ||
        !!p.resume_version?.version_name
    );
}

export function countByTrackerFilter(pursuits: Pursuit[]): Record<Exclude<TrackerFilter, "all">, number> {
    const counts = { saved: 0, applied: 0, interviewing: 0, offer: 0 };
    for (const p of pursuits) {
        if (boardColumn(p) === "saved") counts.saved++;
        if (p.status === "applied") counts.applied++;
        if (p.status === "interviewing") counts.interviewing++;
        if (p.status === "offer") counts.offer++;
    }
    return counts;
}
