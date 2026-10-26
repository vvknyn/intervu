/**
 * localStorage-backed saved job searches — name + serialized /jobs URL state
 * (query + filters from url-state.ts). One store, one key, pure fold helpers
 * unit-tested without a DOM.
 */

import { jobsBoardHref, parseJobsUrl, serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";

export const SAVED_SEARCHES_KEY = "intervu.saved-searches";
export const MAX_SAVED_SEARCHES = 8;

export interface SavedSearch {
    id: string;
    name: string;
    /** Serialized query string from `serializeJobsUrl`, e.g. `?q=pm&work=remote`. */
    href: string;
    createdAt: string;
    /** Where the query came from, recorded at save time (`savedSearchOrigin`). Absent on older rows and on a query the user wrote. */
    origin?: SavedSearchOrigin;
}

/** A search saved while its query was the one the résumé's fit derived. */
export type SavedSearchOrigin = "resume";

/**
 * The origin to record for a search being saved: "resume" only when its query IS the query the résumé's fit
 * derived on this page (`derivedQuery`, null while the search is the visitor's own). Never read from the text.
 */
export function savedSearchOrigin(state: JobsUrlState, derivedQuery: string | null | undefined): SavedSearchOrigin | undefined {
    const q = state.q.trim();
    return q && q === derivedQuery?.trim() ? "resume" : undefined;
}

/** The `origin` property of a stored row, or nothing: a doc must never carry `origin: undefined`, nor a value read from storage unchecked. */
export function originField(origin: unknown): { origin?: SavedSearchOrigin } {
    return origin === "resume" ? { origin } : {};
}

/**
 * THE one place a saved search's query is resolved for use: a résumé-origin search follows the CURRENT
 * résumé's derived query (`resumeQuery`, null when no résumé is on the device, then the stored query stands);
 * any other search is its stored state. Applying a chip, its "new" count and the alert-switch match all
 * call this. The weekly digest runs on the server without the résumé and reads the stored query by ruling.
 */
export function effectiveSavedSearchState(
    s: Pick<SavedSearch, "href" | "origin">,
    resumeQuery: string | null,
): JobsUrlState {
    const state = jobsUrlStateFromSavedHref(s.href);
    // `sort=fit` makes it the résumé's own search: applying it takes the marked, never-logged path.
    return s.origin === "resume" && resumeQuery?.trim() ? { ...state, q: resumeQuery, sort: "fit" } : state;
}

/**
 * Whether a saved search may be sent to the server for its "N new" count now. A résumé-origin one carries the
 * CURRENT résumé's terms, so it goes only while the board is running the résumé's own search
 * (`isResumeOwnSearch`, `resumeSearchOpen`); the stored terms never stand in, since the count would then disagree
 * with the terms the chip shows. Any other saved search is the searcher's own words.
 */
export function mayCountSavedSearch(s: Pick<SavedSearch, "origin">, resumeSearchOpen: boolean): boolean {
    return s.origin !== "resume" || resumeSearchOpen;
}

/** The terms of a boolean query: `"A" OR "B"` (or `A OR B`) → [A, B]; a plain query → itself. */
export function queryTerms(q: string): string[] {
    return q
        .split(/\s+OR\s+/i)
        .map((t) => t.replace(/"/g, "").trim())
        .filter(Boolean);
}

export const RESUME_KEYWORDS_LABEL = "Résumé keywords";

/**
 * What a saved-search chip reads. A name the user typed is shown as written. A name that is just the raw query
 * (what `suggestSavedSearchName` offered when it was saved) becomes "Résumé keywords" for a search saved from
 * the résumé's query, else its first term and "+N more"; `terms` is then the full list for the tooltip and the
 * touch view, and null when the label already shows everything.
 */
export function savedSearchDisplay(
    s: Pick<SavedSearch, "name" | "href" | "origin">,
    resumeQuery: string | null,
): { label: string; terms: string[] | null } {
    const stored = jobsUrlStateFromSavedHref(s.href);
    if (!stored.q.trim() || s.name !== suggestSavedSearchName(stored)) return { label: s.name, terms: null };
    const terms = queryTerms(effectiveSavedSearchState(s, resumeQuery).q);
    if (s.origin === "resume") return { label: RESUME_KEYWORDS_LABEL, terms };
    if (terms.length < 2) return { label: s.name, terms: null };
    return { label: `${terms[0]} +${terms.length - 1} more`, terms };
}

/** Persisted search state omits the open job — reopening is a fresh SERP. */
export function stateForSavedSearch(state: JobsUrlState): JobsUrlState {
    return { ...state, jobId: null };
}

export function hrefFromJobsUrlState(state: JobsUrlState): string {
    return serializeJobsUrl(stateForSavedSearch(state));
}

/**
 * A saved search's state. The panel saves the query string alone
 * (`hrefFromJobsUrlState`, "?q=pm"); an older server row may hold the
 * whole path ("/jobs?q=pm"). Both read the same.
 */
export function jobsUrlStateFromSavedHref(href: string): JobsUrlState {
    const at = href.indexOf("?");
    return parseJobsUrl(new URLSearchParams(at === -1 ? "" : href.slice(at + 1)));
}

/** A link that reruns a saved search on the search board, whichever shape it was saved in. */
export function savedSearchBoardHref(href: string): string {
    return jobsBoardHref(jobsUrlStateFromSavedHref(href));
}

/** What a saved search may hold: its query string, or the /jobs path with one (older rows). */
export function isSavedSearchHref(href: string): boolean {
    return href.startsWith("?") || href === "/jobs" || href.startsWith("/jobs?");
}

export function suggestSavedSearchName(state: JobsUrlState): string {
    const q = state.q.trim();
    if (q) return q.length > 48 ? `${q.slice(0, 45)}…` : q;
    return "Saved search";
}

/**
 * Prepend `entry`, dedupe by exact `href`, cap at `max` — newest wins on
 * duplicate href (name refresh).
 */
export function addSavedSearch(
    list: SavedSearch[],
    entry: Pick<SavedSearch, "name" | "href" | "origin">,
    max = MAX_SAVED_SEARCHES,
    now = (): string => new Date().toISOString(),
): SavedSearch[] {
    const trimmedName = entry.name.trim();
    if (!trimmedName || !entry.href) return list;
    const rest = list.filter((s) => s.href !== entry.href);
    const next: SavedSearch = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: trimmedName,
        href: entry.href,
        createdAt: now(),
        ...originField(entry.origin),
    };
    return [next, ...rest].slice(0, max);
}

export function removeSavedSearch(list: SavedSearch[], id: string): SavedSearch[] {
    return list.filter((s) => s.id !== id);
}

/**
 * Deterministic id for a saved search's SERVER row (actions/saved-searches.ts
 * uses this as the Firestore doc id) — the same `href` always hashes to the
 * same id, so saving (or guest-merging) an identical search twice upserts
 * one row instead of creating a duplicate. Plain FNV-1a, not a crypto hash:
 * this module is shared with the client bundle, so no `node:crypto` import,
 * and dedup-by-construction only needs stability, not collision-resistance
 * (a saved-search list is capped at `MAX_SAVED_SEARCHES`).
 */
export function savedSearchId(href: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < href.length; i++) {
        hash ^= href.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

/**
 * Pure merge decision for one guest row being pushed to the server at
 * sign-in (actions/saved-searches.ts's `syncGuestSavedSearchesAction`) —
 * mirrors `earliestCreatedAt` (actions/follows.ts's own guest merge): when a
 * server row already exists at the same content-hash id (repeat login, or
 * the same search was saved from another device), the EARLIEST createdAt
 * wins so a re-sync never "un-ages" an existing save. Doc id is the hash, so
 * calling this twice with the same guest row and its own prior output as
 * `existingCreatedAt` returns the identical row — that idempotence is what
 * lets the merge trigger run again safely on every login, not just the first.
 */
export function mergedSavedSearchRow(
    guest: Pick<SavedSearch, "name" | "href" | "createdAt" | "origin">,
    existingCreatedAt: string | undefined,
    now = (): string => new Date().toISOString(),
): Pick<SavedSearch, "name" | "href" | "createdAt" | "origin"> {
    const candidates = [existingCreatedAt, guest.createdAt].filter((c): c is string => !!c);
    const createdAt = candidates.length
        ? candidates.reduce((earliest, next) => (Date.parse(next) < Date.parse(earliest) ? next : earliest))
        : now();
    return { name: guest.name.trim(), href: guest.href.trim(), createdAt, ...originField(guest.origin) };
}

function hasLocalStorage(): boolean {
    return typeof localStorage !== "undefined";
}

export function loadSavedSearches(): SavedSearch[] {
    if (!hasLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (v): v is SavedSearch =>
                    typeof v === "object" &&
                    v != null &&
                    typeof (v as SavedSearch).id === "string" &&
                    typeof (v as SavedSearch).name === "string" &&
                    typeof (v as SavedSearch).href === "string" &&
                    typeof (v as SavedSearch).createdAt === "string",
            )
            .slice(0, MAX_SAVED_SEARCHES);
    } catch {
        return [];
    }
}

export function saveSavedSearches(list: SavedSearch[]): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list.slice(0, MAX_SAVED_SEARCHES)));
    } catch {
        /* quota / private mode */
    }
}

export function clearSavedSearches(): void {
    cache = null;
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(SAVED_SEARCHES_KEY);
    } catch {
        /* ignore */
    }
    notify();
}

let cache: SavedSearch[] | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

/**
 * Guest-store change notifications — `use-saved-searches.ts` subscribes to
 * this the same way `lib/follows/guest-store.ts`'s `subscribeGuestFollows`
 * feeds `use-follows.ts`, since this module (not a dedicated guest-store
 * file) is the guest store for saved searches.
 */
export function subscribeSavedSearches(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

export function getSavedSearchesSnapshot(): SavedSearch[] {
    if (cache == null) cache = loadSavedSearches();
    return cache;
}

export function persistSavedSearch(entry: Pick<SavedSearch, "name" | "href" | "origin">): SavedSearch[] {
    const current = getSavedSearchesSnapshot();
    const next = addSavedSearch(current, entry);
    if (next.length === current.length && next.every((s, i) => s.id === current[i]?.id)) return current;
    cache = next;
    saveSavedSearches(next);
    notify();
    return next;
}

export function deleteSavedSearch(id: string): void {
    const current = getSavedSearchesSnapshot();
    const next = removeSavedSearch(current, id);
    if (next.length === current.length) return;
    cache = next;
    saveSavedSearches(next);
    notify();
}
