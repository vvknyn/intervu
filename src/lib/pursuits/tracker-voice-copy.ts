/** User-facing Tracker chrome — warm plain voice, no agent/records jargon. */

export const TRACKER_PAGE_TITLE = "Tracker";

/** The Tracker heading carries the open-role count the nav tab used to wear. */
export function trackerPageHeading(openCount: number): string {
    if (openCount <= 0) return TRACKER_PAGE_TITLE;
    return `${TRACKER_PAGE_TITLE} · ${openCount} ${openCount === 1 ? "job" : "jobs"}`;
}

export const TRACKER_PAGE_SUBCOPY =
    "Your applications, from saved to offer. You decide what gets sent.";

export const TRACKER_PRIMARY_CTA = "Track a role";

export const TRACKER_EXPORT_CSV_LABEL = "Export CSV";

export const TRACKER_EMPTY_TITLE = "Your tracker is empty.";

export const TRACKER_EMPTY_DESCRIPTION =
    "Save roles while browsing verified jobs, then pick up where you left off here.";

export const TRACKER_FILTER_EMPTY = "Nothing in this lane.";

export const HISTORY_EMPTY_TITLE = "Your history is empty.";

export const HISTORY_EMPTY_DESCRIPTION =
    "Open roles from Search or For you and we will keep a trail here so you can find your way back.";
