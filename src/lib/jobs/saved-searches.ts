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

/** Strips raw boolean `"Role A" OR "Role B"…` query syntax down to the primary role title. */
export function cleanSavedSearchName(raw: string): string {
    const trimmed = raw.trim();
    const quotedOr = trimmed.match(/^\s*"([^"]+)"\s+OR\b/i);
    if (quotedOr?.[1]?.trim()) {
        return quotedOr[1].trim();
    }
    return trimmed;
}

export function suggestSavedSearchName(state: JobsUrlState): string {
    const q = cleanSavedSearchName(state.q);
    if (q) return q.length > 48 ? `${q.slice(0, 45)}…` : q;
    return "Saved search";
}

/**
 * Prepend `entry`, dedupe by exact `href`, cap at `max` — newest wins on
 * duplicate href (name refresh).
 */
export function addSavedSearch(
    list: SavedSearch[],
    entry: Pick<SavedSearch, "name" | "href">,
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
    guest: Pick<SavedSearch, "name" | "href" | "createdAt">,
    existingCreatedAt: string | undefined,
    now = (): string => new Date().toISOString(),
): Pick<SavedSearch, "name" | "href" | "createdAt"> {
    const candidates = [existingCreatedAt, guest.createdAt].filter((c): c is string => !!c);
    const createdAt = candidates.length
        ? candidates.reduce((earliest, next) => (Date.parse(next) < Date.parse(earliest) ? next : earliest))
        : now();
    return { name: guest.name.trim(), href: guest.href.trim(), createdAt };
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

export function persistSavedSearch(entry: Pick<SavedSearch, "name" | "href">): SavedSearch[] {
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
