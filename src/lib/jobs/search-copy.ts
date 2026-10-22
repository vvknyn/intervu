/** Single source of truth for the /jobs search box's query-field
 *  placeholder — consumed by the live page (jobs/page.tsx) and the
 *  search-dock mockup (components/mock/SearchDockMock.tsx, reachable at
 *  /mock/search-dock). A second hardcoded copy of this string drifted out
 *  of sync with the live copy before (the mock still said "What kind of
 *  work are you looking for?" after the live page moved on) — see
 *  tests/unit/search-placeholder-single-source.test.ts, which scans `src`
 *  for any other literal copy of either string.
 */
export const SEARCH_PLACEHOLDER = "Job title, skill, or company";

export const FIT_SEARCH_PLACEHOLDER = "Search within your matches";

/**
 * What the search box shows. A fit list whose query is the résumé's own derived one (the visitor never typed it) shows
 * an empty box that searches within the matches; typing then narrows them. Display only: the address keeps the query.
 */
export function searchBoxFor(draft: string, query: string, fitActive: boolean, packQuery: string | null): { value: string; placeholder: string } {
    const fitsOwn = fitActive && packQuery !== null && query === packQuery && draft === query;
    return fitsOwn ? { value: "", placeholder: FIT_SEARCH_PLACEHOLDER } : { value: draft, placeholder: SEARCH_PLACEHOLDER };
}
