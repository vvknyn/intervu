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
