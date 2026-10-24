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
 * This is Velai's demand record: what people search for, where, and what came
 * back, so the admin "Search demand" view can say what is popular, what finds
 * nothing, and which places and companies need ingesting. It is the ONLY
 * place a search's words are kept: analytics (PostHog, the behavioural
 * ledger) get the search's shape, never its text (`stripUrlQueries`,
 * `captureEvent("search_submitted")`).
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

/** How long an event lives. Deletion is `sweepExpiredSearchLog` below: the
 *  Firestore TTL policy that used to enforce it went with Firestore. */
export const SEARCH_LOG_TTL_DAYS = 90;

/** Places, companies and filters per search are capped here, each value at
 *  `SEARCH_LOG_VALUE_MAX` characters: a demand record, not a transcript. */
export const SEARCH_LOG_LIST_MAX = 5;
export const SEARCH_LOG_VALUE_MAX = 80;

const LOCATION_FACETS: readonly string[] = ["location_country", "location_city", "location_state"];

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
    /** The places the search was limited to (country, state or city picks). */
    places: string[];
    /** The country the search defaulted to from the visitor's IP when no place
     *  was given (ISO2), or "". The IP itself is never kept. */
    defaultedCountry: string;
    /** Typed places with no roles in the index ("We have no roles in…"). */
    unmatchedPlaces: string[];
    /** The company the search was scoped to (its domain), or "". */
    company: string;
    /** Employers the query named that have no open roles here: the query
     *  matched a known company, scoped to it, found nothing and fell back. */
    missedCompanies: string[];
    /** Every other explicit facet pick as "facet:value" (work type, level...). */
    filters: string[];
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
 * A later page of the same list (`offset` > 0) and a count probe (`limit` of
 * 0 or 1: the Broaden options' "how many if…" checks) are not new searches;
 * logging them counted one search several times and put queries nobody typed
 * among the ones that found nothing.
 */
export function shouldLogSearch(params: JobSearchParams): boolean {
    if (params.id || params.automatic === true || params.fromResume === true) return false;
    if ((params.offset ?? 0) > 0) return false;
    return params.limit === undefined || params.limit > 1;
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

/** What `runJobsSearch` returns beyond `JobSearchResult` that says where the
 *  search looked (search.ts). */
export type SearchLogResult = JobSearchResult & {
    defaultedLocation?: string;
    unmatchedPlaceMentions?: string[];
};

/** Pure: trimmed, non-empty, de-duplicated, capped values. */
function capped(values: readonly (string | undefined | null)[]): string[] {
    const out: string[] = [];
    for (const value of values) {
        const v = (value ?? "").trim().slice(0, SEARCH_LOG_VALUE_MAX);
        if (v && !out.includes(v)) out.push(v);
        if (out.length === SEARCH_LOG_LIST_MAX) break;
    }
    return out;
}

/** Pure: the stored shape of one search. */
export function buildSearchLogEntry(
    params: JobSearchParams,
    result: SearchLogResult,
    ctx: SearchLogContext,
): SearchLogEntry {
    const raw = (params.q ?? "").trim();
    const facets = Object.entries(params.facets ?? {});
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
        places: capped(facets.filter(([key]) => LOCATION_FACETS.includes(key)).flatMap(([, values]) => values ?? [])),
        defaultedCountry: (result.defaultedLocation ?? "").slice(0, SEARCH_LOG_VALUE_MAX),
        unmatchedPlaces: capped(result.unmatchedPlaceMentions ?? []),
        company: (params.companyDomain ?? "").trim().slice(0, SEARCH_LOG_VALUE_MAX),
        missedCompanies: result.companyIntent?.fallback ? capped(result.companyIntent.domains) : [],
        filters: capped(
            facets
                .filter(([key]) => !LOCATION_FACETS.includes(key))
                .flatMap(([key, values]) => (values ?? []).map((value) => `${key}:${value}`)),
        ),
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

/** How often one server checks for records past `expiresAt`, and how many it
 *  deletes per pass at most (batches of `SWEEP_BATCH`). */
export const SWEEP_EVERY_MS = 6 * 3_600_000;
const SWEEP_BATCH = 500;
const SWEEP_MAX_BATCHES = 20;

let lastSweepAt = 0;

/** Pure: has it been long enough since this server last swept? */
export function isSweepDue(lastAt: number, now: number): boolean {
    return now - lastAt >= SWEEP_EVERY_MS;
}

/**
 * Deletes searches and opens past their `expiresAt`, so the log keeps
 * SEARCH_LOG_TTL_DAYS as /privacy says. Run from the write path at most once
 * per SWEEP_EVERY_MS per server, so it needs no cron of its own; several
 * servers sweeping at once delete the same rows, which is harmless.
 */
export async function sweepExpiredSearchLog(now: number): Promise<number> {
    const db = getAdminDb();
    const cutoff = new Date(now).toISOString();
    let deleted = 0;
    for (const collection of [COLLECTION_SEARCHES, COLLECTION_OPENS]) {
        for (let i = 0; i < SWEEP_MAX_BATCHES; i++) {
            const expired = await db.collection(collection).where("expiresAt", "<", cutoff).limit(SWEEP_BATCH).get();
            if (expired.empty) break;
            const batch = db.batch();
            expired.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            deleted += expired.size;
            if (expired.size < SWEEP_BATCH) break;
        }
    }
    return deleted;
}

/**
 * The write path's I/O. Telemetry must never break search, so a write
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
    const now = Date.now();
    if (!isSweepDue(lastSweepAt, now)) return;
    lastSweepAt = now;
    try {
        await sweepExpiredSearchLog(now);
    } catch (err) {
        console.error("[search-log] deleting expired records failed:", err);
    }
}

export const recordSearch = (entry: SearchLogEntry): Promise<void> =>
    write(COLLECTION_SEARCHES, entry);

export const recordJobOpen = (entry: JobOpenLogEntry): Promise<void> =>
    write(COLLECTION_OPENS, entry);
