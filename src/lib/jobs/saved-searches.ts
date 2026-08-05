/**
 * localStorage-backed saved job searches — name + serialized /jobs URL state
 * (query + filters from url-state.ts). One store, one key, pure fold helpers
 * unit-tested without a DOM.
 */

import { parseJobsUrl, serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";

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

export function jobsUrlStateFromSavedHref(href: string): JobsUrlState {
    const qs = href.startsWith("?") ? href.slice(1) : href;
    return parseJobsUrl(new URLSearchParams(qs));
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
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(SAVED_SEARCHES_KEY);
    } catch {
        /* ignore */
    }
}

const EMPTY: SavedSearch[] = [];
let cache: SavedSearch[] | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

export function subscribeSavedSearches(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

export function getSavedSearchesSnapshot(): SavedSearch[] {
    if (cache == null) cache = loadSavedSearches();
    return cache;
}

export function getSavedSearchesServerSnapshot(): SavedSearch[] {
    return EMPTY;
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
