/**
 * The ONE recent-searches store for the jobs search surface.
 *
 * Two UI surfaces read it — SearchAutocomplete's dropdown history and the
 * /jobs empty-query landing chips — and both must always show the SAME
 * history, so there is exactly one key, one write path, and one notify
 * fan-out here. The key is the incumbent one SearchAutocomplete already
 * wrote (plain JSON string array), so pre-unification history survives.
 *
 * Layers, seam by seam:
 *   - `rememberSearch` — the pure fold (list, submitted query) → next list,
 *     unit-tested without a DOM (tests/unit/jobs-recent-searches.test.ts).
 *   - `load/save/clearRecentSearches` — the only things that touch
 *     `localStorage`, same shape as `lib/prep/plan-list.ts`'s wrappers: any
 *     failure (SSR, private-mode quota, malformed JSON) degrades to "no
 *     recent searches" rather than throwing — an absent store is not an
 *     error.
 *   - the module-level store — a `useSyncExternalStore`-compatible
 *     subscribe/snapshot pair plus the two mutations (`recordRecentSearch`,
 *     `clearAllRecentSearches`). `recentSearchesCache` is the one boxed
 *     reference `getRecentSearchesSnapshot` hands back; a write replaces it
 *     and notifies, so subscribers only re-render on an actual change — an
 *     unboxed `loadRecentSearches()` call from the snapshot getter would
 *     return a fresh array reference every call and loop.
 */

export const RECENT_SEARCHES_KEY = "interview-os-recent-searches";
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

/** Read the stored recent-search list, capped at the store max (legacy data
 *  under this key ran to 10 entries; every current surface shows at most
 *  `DEFAULT_MAX`). Absent/corrupt storage reads as "no recent searches",
 *  never a thrown error. */
export function loadRecentSearches(): string[] {
    if (!hasLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === "string").slice(0, DEFAULT_MAX);
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

/** Clear the stored recent-search list. */
export function clearRecentSearches(): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
        /* ignore */
    }
}

/* ------------------------- shared reactive store ------------------------- */

const EMPTY_RECENT_SEARCHES: string[] = [];
let recentSearchesCache: string[] | null = null;
const recentSearchesListeners = new Set<() => void>();

function notifyRecentSearchesChanged(): void {
    recentSearchesListeners.forEach((cb) => cb());
}

export function subscribeRecentSearches(onChange: () => void): () => void {
    recentSearchesListeners.add(onChange);
    return () => recentSearchesListeners.delete(onChange);
}

export function getRecentSearchesSnapshot(): string[] {
    if (recentSearchesCache == null) recentSearchesCache = loadRecentSearches();
    return recentSearchesCache;
}

/** SSR snapshot — empty matches what the server renders (no chips, no
 *  history rows), so hydration can't mismatch. */
export function getRecentSearchesServerSnapshot(): string[] {
    return EMPTY_RECENT_SEARCHES;
}

/**
 * Fold a COMMITTED query into the store and persist — the one write path.
 * Every commit route (typed Enter, suggestion pick, recent-chip click)
 * funnels here via the jobs page's `submitSearch` chokepoint. No-ops (no
 * cache write, no notify) when the fold changes nothing — a noise query, or
 * re-submitting the query already at the front.
 */
export function recordRecentSearch(q: string): void {
    const current = getRecentSearchesSnapshot();
    const next = rememberSearch(current, q);
    if (next === current) return;
    if (next.length === current.length && next.every((v, i) => v === current[i])) return;
    recentSearchesCache = next;
    saveRecentSearches(next);
    notifyRecentSearchesChanged();
}

/** Drop ONE query from the store (a landing chip's "×") — same
 *  cache+persist+notify contract as `recordRecentSearch`, case-insensitive
 *  match to mirror `resolveSearchSeeds`' dedupe rule. */
export function removeRecentSearch(q: string): void {
    const current = getRecentSearchesSnapshot();
    const needle = q.trim().toLowerCase();
    const next = current.filter((v) => v.toLowerCase() !== needle);
    if (next.length === current.length) return;
    recentSearchesCache = next;
    saveRecentSearches(next);
    notifyRecentSearchesChanged();
}

/** Wipe the store entirely (the landing chips' "×") — the dropdown history
 *  empties with it, since both surfaces subscribe to this one store. */
export function clearAllRecentSearches(): void {
    recentSearchesCache = EMPTY_RECENT_SEARCHES;
    clearRecentSearches();
    notifyRecentSearchesChanged();
}

/* ------------------------- empty-search seed queries ------------------------- */

/**
 * Curated fallback role titles for the SERP-ask empty-search state
 * (page.tsx's `resolveEmptySearchState` → `"serp-ask"`) — recent searches
 * fill first, this backfills the rest. Exported so it stays the one list a
 * future surface would reuse rather than a second hand-typed copy.
 */
export const CURATED_SEARCH_SEEDS = [
    "product manager",
    "software engineer",
    "data scientist",
    "account manager",
    "customer success manager",
    "marketing manager",
    "product designer",
    "sales engineer",
];

const SEED_TARGET = 8;

/**
 * Recent searches first, then curated fallbacks, case-insensitively deduped
 * (a resubmitted curated title doesn't appear twice), capped at `target`.
 * Pure — unit-tested without the store/localStorage above.
 */
export function resolveSearchSeeds(
    recent: string[],
    curated: string[] = CURATED_SEARCH_SEEDS,
    target = SEED_TARGET,
): string[] {
    const seen = new Set<string>();
    const seeds: string[] = [];
    for (const q of [...recent, ...curated]) {
        const trimmed = q.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        seeds.push(trimmed);
        if (seeds.length >= target) break;
    }
    return seeds;
}
