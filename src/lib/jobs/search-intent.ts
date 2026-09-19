/**
 * Whether /jobs has search intent — the one gate between the at-rest front
 * door (Search primitives panel, the résumé/sign-in prompt, the marketing
 * sections) and the live results surface (the results list, its skeleton
 * rows, the result-count line, and the fetch that populates all three).
 *
 * Product decision (Vivek, 2026-09-18): the at-rest page must never render
 * or fetch results — "it's confusing the user." One OR of every way a
 * visitor can arrive at "show me jobs," so a future entry point is covered
 * by construction instead of a new special case landing here later:
 *
 *  - `query`: the debounced (never per-keystroke) search text is non-empty.
 *  - `filtersAwayFromDefault`: any filter or sort control differs from its
 *    default — pass `activeFilterEntries(filterState).length > 0` (facets,
 *    salary, visa, an explicit posted-bucket pin, board/company scope) OR
 *    `sortOverride !== null` (an explicit sort choice).
 *  - `explicitlySubmitted`: the visitor hit Enter or the search button at
 *    least once this page session — including an empty query ("browse
 *    all"). Sticky: the caller holds this in state and must not clear it
 *    on its own; only a fresh mount resets it.
 *  - `jobOpen`: a job is open via the URL's `?job=` — a deliberate deep
 *    link or row click, never the ambient default-browse auto-selection
 *    (see `resolveSelectionAfterRefresh`, result-state.ts). This is the one
 *    URL-carried signal not already implied by `query`/filters/sort above
 *    (which are themselves seeded from the URL on mount).
 *  - `forYouActive`: For-you (signed in with a usable résumé) is showing —
 *    that surface is always a ranked-results view, never the at-rest page.
 *
 * When every clause clears (query emptied before any submit, filters back
 * to their defaults, no job open, For-you not active), this returns to
 * false and the page returns to rest — there is no additional state here
 * beyond the caller-held `explicitlySubmitted` flag, so nothing but that
 * one flag can keep the page out of rest once the rest all clear.
 */
export interface SearchIntentInput {
    query: string;
    filtersAwayFromDefault: boolean;
    explicitlySubmitted: boolean;
    jobOpen: boolean;
    forYouActive: boolean;
}

export function hasSearchIntent(input: SearchIntentInput): boolean {
    return (
        Boolean(input.query.trim()) ||
        input.filtersAwayFromDefault ||
        input.explicitlySubmitted ||
        input.jobOpen ||
        input.forYouActive
    );
}
