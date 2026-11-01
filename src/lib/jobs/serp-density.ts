/**
 * Where the filters render on /jobs.
 *
 *   rail   — lg+ with a results list on screen: a left column beside the list,
 *            open until the searcher hides it (the Filters button toggles it).
 *   drawer — lg+ with no list yet (nothing to put a column beside): a left
 *            drawer the Filters button opens.
 *   sheet  — below lg: a bottom sheet the Filters button opens.
 *
 * Class strings stay at the call site in app/jobs/JobsContent.tsx; this file
 * holds the mount-site decision only, so it can be asserted without rendering.
 */

export type FiltersSurface = "rail" | "drawer" | "sheet";

export function resolveFiltersSurface(input: { isLgUp: boolean; resultsShown: boolean }): FiltersSurface {
    if (!input.isLgUp) return "sheet";
    return input.resultsShown ? "rail" : "drawer";
}

/**
 * Whether the filters are on screen right now. A rail is on screen until it is
 * hidden; a drawer or sheet only while it is open. One answer for the toolbar
 * toggle's `aria-expanded` and for the header's docked toggle.
 */
export function filtersOnScreen(input: { surface: FiltersSurface; railHidden: boolean; overlayOpen: boolean }): boolean {
    return input.surface === "rail" ? !input.railHidden : input.overlayOpen;
}
