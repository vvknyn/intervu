/**
 * The first search of a /jobs search landing (`/jobs?q=nurse`), started the
 * moment the page hydrates instead of once JobsContent has mounted.
 *
 * On a throttled phone profile JobsContent mounted ~600 ms after hydration
 * (its code is large), and only then sent the search, so the request's round
 * trip came on top of that. `JobsRouteGate` now sends the same request from
 * its first effect, and JobsContent's search wrapper takes the pending
 * result when its own first request is the same one (same params, compared
 * whole), so the rows can render in the commit that mounts the list.
 *
 * Only a typed search landing qualifies. For you, résumé fit and the bare
 * board send other requests (a deeper first page, the cached default
 * browse), and anything the page decides after mounting (a location default
 * the visitor dismissed, a résumé) either feeds in here too or changes the
 * params, in which case nothing is taken and JobsContent searches as before.
 * The pending result is taken at most once.
 */
import { buildJobSearchPayload, urlSortToBackendSort } from "./search-payload";
import { coerceSortToSupported, resolveEffectiveSort } from "./sort";
import type { JobSearchParams } from "./types";
import { parseJobsUrl } from "./url-state";

/** JobsContent's first-page size for a search list (its `PAGE`). */
export const SEARCH_FIRST_PAGE_SIZE = 20;

/**
 * The request JobsContent's first search sends for this URL, built the way
 * its search effect builds it from the state it seeds from the URL, or
 * `null` when the landing is not a typed search.
 */
export function earlyFirstSearchParams(search: string, suppressLocationDefault: boolean): JobSearchParams | null {
    const state = parseJobsUrl(new URLSearchParams(search));
    if (!state.q.trim() || state.sort === "fit" || state.homeView === "for-you") return null;
    // JobsContent: sortOverride = urlSortToBackendSort(url sort); backendSort =
    // coerceSortToSupported(resolveEffectiveSort(...), postedDateSupported),
    // with postedDateSupported starting true.
    const sortOverride = urlSortToBackendSort(state.sort);
    const sort = coerceSortToSupported(resolveEffectiveSort({ q: state.q, sort: sortOverride ?? undefined }), true);
    const filterState = {
        facets: state.facets,
        salaryMin: state.salaryMin,
        visaOnly: state.visaOnly,
        postedBucket: state.postedBucket,
        postedExplicit: state.postedExplicit || undefined,
        yearsExperience: state.yearsExperience,
        hideGhosts: state.hideGhosts,
        board: state.board,
        companyDomain: state.companyDomain,
    };
    return {
        ...buildJobSearchPayload(filterState, state.q, sort, true, suppressLocationDefault),
        withFacets: true,
        limit: SEARCH_FIRST_PAGE_SIZE,
        offset: 0,
    };
}

/** Order-independent identity of a request; undefined fields don't count. */
export function searchParamsKey(params: JobSearchParams): string {
    const normalize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>)
                    .filter(([, v]) => v !== undefined)
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([k, v]) => [k, normalize(v)]),
            );
        }
        return value;
    };
    return JSON.stringify(normalize(params));
}

/** A result nobody took by then is too old to stand in for a fresh search. */
export const EARLY_FIRST_SEARCH_TTL_MS = 15_000;

let pending: { key: string; result: Promise<unknown>; startedAt: number } | null = null;

export function startEarlyFirstSearch<R>(
    params: JobSearchParams,
    run: (params: JobSearchParams) => Promise<R>,
    now: number = Date.now(),
): void {
    const result = run(params);
    // Taken or not, a failure here must not surface as an unhandled rejection;
    // a taker sees it through its own `.then`.
    result.catch(() => {});
    pending = { key: searchParamsKey(params), result, startedAt: now };
}

/**
 * The pending early result when it was for exactly these params and is
 * fresh, at most once. A request for other params (a count, a pack) leaves
 * it for the search it was meant for.
 */
export function takeEarlyFirstSearch<R>(params: JobSearchParams, now: number = Date.now()): Promise<R> | null {
    if (!pending) return null;
    if (now - pending.startedAt > EARLY_FIRST_SEARCH_TTL_MS) {
        pending = null;
        return null;
    }
    if (pending.key !== searchParamsKey(params)) return null;
    const { result } = pending;
    pending = null;
    return result as Promise<R>;
}

/** Tests only. */
export function resetEarlyFirstSearchForTests(): void {
    pending = null;
}
