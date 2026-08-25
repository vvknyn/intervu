/**
 * Where the facet controls render on /jobs — inline expand at lg+, bottom
 * sheet below. Class strings stay at the call site in app/jobs/page.tsx;
 * this file holds the mount-site decision only.
 */

export type FacetsMountSite = "inline" | "sheet";

export function resolveFacetsMountSite(input: {
    isXlUp: boolean;
    isLgUp: boolean;
    filtersOpen: boolean;
}): FacetsMountSite | null {
    if (!input.filtersOpen) return null;
    return input.isLgUp ? "inline" : "sheet";
}

/** The Filters toggle reveals a panel — always shown (no standing facet rail). */
export function showsFiltersToggle(_site: FacetsMountSite | null): boolean {
    return true;
}
