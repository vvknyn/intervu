/**
 * Search telemetry — what people asked for, and whether it worked.
 *
 * Exists because the Phase-1 redesign removes the filter panel, and "did
 * anyone rely on filters" is unanswerable once they're gone: there is no
 * before to compare against. See
 * `docs/superpowers/specs/2026-07-25-search-journey-phase1-design.md`.
 *
 * Deliberately anonymous. No uid, no IP, no user agent — `searchId` is random
 * per search, so events cannot be chained back into one person's history. The
 * only reason it exists is to join a search to the result it opened.
 *
 * Pure decision + builder / thin I/O, matching the house pattern
 * (`shouldRelaxSearch`, `shouldDemoteActiveEmpty`): everything worth testing
 * — truncation, defaults, what counts as a filter, what's worth logging at
 * all — is pure and needs no Firestore to assert on.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { JobSearchParams, JobSearchResult, JobsBackendKind } from "./types";

/** Logged query text is capped here. Independent of the typeahead's own input
 *  cap — that one bounds what reaches a backend, this one bounds what we store. */
export const SEARCH_LOG_Q_MAX = 200;

/** How long an event lives. The field is written here; deletion is enforced by
 *  the Firestore TTL policy on `expiresAt`, which must be enabled in the
 *  console — see the plan doc. Without that policy this value is decorative. */
export const SEARCH_LOG_TTL_DAYS = 90;

const COLLECTION_SEARCHES = "search_events";
const COLLECTION_OPENS = "search_opens";

export interface SearchLogEntry {
    searchId: string;
    q: string;
    /** Length BEFORE truncation — the signal for "sentences or keywords?". */
    qLength: number;
    resultCount: number;
    /** True when the title/company pass was thin and the search widened. */
    widened: boolean;
    backend: JobsBackendKind;
    /** A failed search, as distinct from a genuinely empty one. */
    unavailable: boolean;
    /** Records whether the fresh-visit default ("90d" since 2026-09-30,
     *  "30d" before) was in play. */
    postedBucket: string;
    /** Any EXPLICIT filter — facet, salary floor, or visa. Defaults don't count;
     *  the question this answers is "did a human reach for a filter". */
    filtersApplied: boolean;
    createdAt: string;
    expiresAt: string;
}

export interface JobOpenLogEntry {
    searchId: string;
    jobId: string;
    /** Position in the result list. Opening #1 and opening #34 say opposite
     *  things about our ranking, so the rank IS the relevance signal. */
    rank: number;
    createdAt: string;
    expiresAt: string;
}

/** Clock + id injected so the builders are deterministic under test. */
export interface SearchLogContext {
    searchId: string;
    now: number;
}

function lifespan(now: number): { createdAt: string; expiresAt: string } {
    return {
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SEARCH_LOG_TTL_DAYS * 86_400_000).toISOString(),
    };
}

/**
 * Pure: is this a search a human performed?
 *
 * `params.id` is the dead-link existence probe ("does this exact posting still
 * exist"), issued by the app rather than typed by anyone. Logging it would
 * bury real queries under machine traffic. `params.automatic` is the browser
 * extension's on-page card looking up the job page that just loaded: the
 * same, machine traffic. `params.fromResume` is a query built from the
 * person's résumé: kept out so the log never holds résumé words (/privacy).
 */
export function shouldLogSearch(params: JobSearchParams): boolean {
    return !params.id && params.automatic !== true && params.fromResume !== true;
}

/** Pure: any explicit filter the user reached for. `hideGhosts` and
 *  `postedBucket` are excluded — both carry first-screen defaults, so their
 *  presence says nothing about intent. `postedBucket` is recorded as its own
 *  field precisely so the default is visible without being miscounted here. */
export function hasExplicitFilters(params: JobSearchParams): boolean {
    const facetValues = Object.values(params.facets ?? {});
    return (
        facetValues.some((values) => (values?.length ?? 0) > 0) ||
        typeof params.salaryMin === "number" ||
        params.visaOnly === true
    );
}

/** Pure: the stored shape of one search. */
export function buildSearchLogEntry(
    params: JobSearchParams,
    result: JobSearchResult,
    ctx: SearchLogContext,
): SearchLogEntry {
    const raw = (params.q ?? "").trim();
    return {
        searchId: ctx.searchId,
        q: raw.slice(0, SEARCH_LOG_Q_MAX),
        qLength: raw.length,
        resultCount: result.total,
        widened: result.widened === true,
        backend: result.backend,
        unavailable: result.unavailable === true,
        postedBucket: params.postedBucket ?? "",
        filtersApplied: hasExplicitFilters(params),
        ...lifespan(ctx.now),
    };
}

/** Pure: the stored shape of one opened result. */
export function buildJobOpenEntry(
    searchId: string,
    jobId: string,
    rank: number,
    now: number,
): JobOpenLogEntry {
    return { searchId, jobId, rank, ...lifespan(now) };
}

/**
 * The only I/O in this module. Telemetry must never break search, so a write
 * failure is swallowed — but it is reported to the server log rather than
 * silently dropped, so a broken pipeline is discoverable instead of looking
 * like an absence of traffic.
 */
async function write(collection: string, entry: object): Promise<void> {
    try {
        await getAdminDb().collection(collection).add(entry);
    } catch (err) {
        console.error(`[search-log] write to ${collection} failed:`, err);
    }
}

export const recordSearch = (entry: SearchLogEntry): Promise<void> =>
    write(COLLECTION_SEARCHES, entry);

export const recordJobOpen = (entry: JobOpenLogEntry): Promise<void> =>
    write(COLLECTION_OPENS, entry);
