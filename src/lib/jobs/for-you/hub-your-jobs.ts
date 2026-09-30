/**
 * The packs hub's "your jobs" band — the tracker and Recently viewed
 * sections under the pack tiles. Pure picks and copy, no I/O, no React, so
 * the component (`HubYourJobs`) and its /mock fixture render the same rows.
 */

import { formatRelativeAge } from "@/lib/jobs/freshness";
import { countByTrackerFilter, isStalePursuit, daysSinceUpdate } from "@/lib/pursuits/tracker-display";
import { hasReachedStage, isEnded, orderPursuits, type Pursuit } from "@/lib/pursuits/types";
import type { JobView } from "@/lib/views/types";

/** Tracker rows the hub shows before "Open tracker" takes over. */
export const HUB_TRACKER_ROWS = 6;

/** Recently viewed rows — the last 20 jobs opened, on any device. */
export const HUB_RECENT_ROWS = 20;

/**
 * Open pursuits, the ones already sent first: interviews by date, then
 * applied and offers by last move (`orderPursuits`), then saved roles.
 * Rejected and withdrawn stay in the tracker itself.
 */
export function hubTrackerRows(pursuits: Pursuit[], max = HUB_TRACKER_ROWS): Pursuit[] {
    const open = orderPursuits(pursuits).filter((p) => !isEnded(p));
    const sent = open.filter((p) => hasReachedStage(p, "applied"));
    const saved = open.filter((p) => !hasReachedStage(p, "applied"));
    return [...sent, ...saved].slice(0, max);
}

export function hubRecentRows(views: JobView[], max = HUB_RECENT_ROWS): JobView[] {
    return views.slice(0, max);
}

export interface HubTrackerStat {
    key: "applied" | "interviewing" | "offer" | "saved";
    label: string;
    value: number;
}

/** Same buckets as the /yours filter chips (`countByTrackerFilter`), applied first. */
export function hubTrackerStats(pursuits: Pursuit[]): HubTrackerStat[] {
    const counts = countByTrackerFilter(pursuits);
    return [
        { key: "applied", label: "Applied", value: counts.applied },
        { key: "interviewing", label: "Interviewing", value: counts.interviewing },
        { key: "offer", label: counts.offer === 1 ? "Offer" : "Offers", value: counts.offer },
        { key: "saved", label: "Saved", value: counts.saved },
    ];
}

/** "applied 3d ago" for a sent role, "saved 2h ago" before it was sent, and
 *  "tracked 5d ago" for one sent with no application date on file. */
export function hubTrackerAgeLabel(p: Pursuit, nowMs: number): string | null {
    const sent = hasReachedStage(p, "applied");
    if (sent && p.applied_at && !Number.isNaN(Date.parse(p.applied_at))) {
        return `applied ${formatRelativeAge(p.applied_at, nowMs)}`;
    }
    if (Number.isNaN(Date.parse(p.created_at))) return null;
    return `${sent ? "tracked" : "saved"} ${formatRelativeAge(p.created_at, nowMs)}`;
}

/** "no update in 16d" on an application still waiting on a reply — the tracker's own stale fact. */
export function hubTrackerStaleLabel(p: Pursuit, nowMs: number): string | null {
    return isStalePursuit(p, nowMs) ? `no update in ${daysSinceUpdate(p, nowMs)}d` : null;
}

export const HUB_YOUR_JOBS_COPY = {
    trackerTitle: "Your tracker",
    trackerLink: "Open tracker",
    trackerEmpty: "Roles you save or apply to show up here with their stage.",
    trackerAllClosed: "Nothing open right now. Closed roles stay in your tracker.",
    recentTitle: "Recently viewed",
    recentLink: "See all history",
    recentEmpty: "Open a role from a pack or a search and it shows up here, on any device.",
    /** Signed-out placeholders — what each section holds once signed in. */
    trackerPlaceholder: "The roles you've applied to and saved, with where each one stands.",
    recentPlaceholder: "The last 20 roles you opened, on any device.",
} as const;
