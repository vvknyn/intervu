import { needsResumeEntry } from "@/lib/jobs/resume-entry";

/**
 * Whether /jobs is showing its "at rest" front door — search takes center
 * stage, no result row is pre-selected, marketing sits quietly. Deliberately
 * BROADER than `isPristineLanding` (page.tsx): that gate also requires zero
 * active filters and no fit-rank, because it decides whether to show the
 * marketing masthead at all. This one only asks "is there anything to show
 * instead of the empty state" — a typed query, or a deliberately opened job
 * (`?job=`, a real click/deep-link, never the ambient default-browse
 * auto-selection — see `resolveSelectionAfterRefresh`, result-state.ts). A
 * visitor who has only toggled a filter chip (e.g. "remote only") hasn't
 * searched for anything yet, so the centered hero and the band still make
 * sense; the two-pane results layout should not snap in under them just
 * because a facet changed.
 */
export function isAtRest({ query, jobParam }: { query: string; jobParam: string | null }): boolean {
    return !query.trim() && !jobParam;
}

/**
 * Whether the front-door résumé-upload band should render. One rule reused
 * at both its mount sites (desktop under the masthead, mobile inside the
 * results flatMap) so they can't drift apart — the band only ever shows at
 * rest, and only when `needsResumeEntry` says this visitor doesn't have a
 * usable résumé on record yet.
 */
export function showsFrontDoorBand(input: {
    atRest: boolean;
    signedIn: boolean;
    resumeOnFile: boolean | null;
    fitActive: boolean;
}): boolean {
    return input.atRest && needsResumeEntry(input);
}
