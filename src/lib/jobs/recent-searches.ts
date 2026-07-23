/**
 * Recent-searches memory for the /jobs empty-query landing state.
 *
 * `rememberSearch` is the pure fold (list, submitted query) → next list —
 * unit-tested without a DOM (tests/unit/jobs-recent-searches.test.ts). The
 * three `*RecentSearches` functions below are the only things that touch
 * `localStorage`, following the same shape as `lib/prep/plan-list.ts`'s
 * storage wrappers: any failure (SSR with no `localStorage`, private-mode
 * quota, malformed JSON) degrades to "no recent searches" rather than
 * throwing — an absent store is not an error.
 */

export const RECENT_SEARCHES_KEY = "intervu.jobs.recent-searches";
const DEFAULT_MAX = 3;

/**
 * Fold a newly-submitted query into `list`, newest-first, deduped case-
 * insensitively — a resubmitted query moves to the front under its NEW
 * casing rather than creating a second entry — capped at `max`. A query
 * that's empty or a single character after trimming is noise, not search
 * intent: returns `list` unchanged rather than remembering it.
 */
export function rememberSearch(list: string[], q: string, max = DEFAULT_MAX): string[] {
    const trimmed = q.trim();
    if (trimmed.length < 2) return list;
    const key = trimmed.toLowerCase();
    const rest = list.filter((item) => item.toLowerCase() !== key);
    return [trimmed, ...rest].slice(0, max);
}

function hasLocalStorage(): boolean {
    return typeof localStorage !== "undefined";
}

/** Read the stored recent-search list. Absent/corrupt storage reads as "no
 *  recent searches", never a thrown error. */
export function loadRecentSearches(): string[] {
    if (!hasLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
        return [];
    }
}

/** Persist the recent-search list. Quota errors / SSR are silently ignored —
 *  losing the memory is not a functional failure. */
export function saveRecentSearches(list: string[]): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
    } catch {
        /* ignore quota errors */
    }
}

/** Clear the stored recent-search list (the landing state's "×"). */
export function clearRecentSearches(): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
        /* ignore */
    }
}
