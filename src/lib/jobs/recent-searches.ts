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
 *  cache+persist+notify contract as `recordRecentSearch`. Case-insensitive,
 *  but EXACT otherwise: this removes the entry the searcher pointed at, not
 *  everything `resolveSearchSeeds` would have collapsed with it (a near-dupe
 *  it was hiding can legitimately surface in its place). */
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
 * Below this length a single character IS the whole distinction between two
 * searches — "ai"/"ui", "java"/"lava", "sre"/"sde" are different questions,
 * not typos of each other — so near-duplicate collapsing only applies once
 * the strings are long enough for a one-character difference to be evidence
 * of a slip rather than of intent. Exact (case-insensitive) dedupe still
 * applies at every length.
 */
const NEAR_DUPLICATE_MIN_LENGTH = 8;

/**
 * Are two already-normalized seed keys within ONE edit (insert, delete or
 * substitute) of each other? Recent searches are raw human typing, so the
 * store legitimately holds a query and its own typo as separate entries —
 * live: "customer success manager" AND "customer success managr" sat side by
 * side as sibling seed chips (prod screenshot 2026-08-08). Exact-match
 * dedupe can't see that; a full edit-distance matrix is more machinery than
 * the question needs.
 *
 * Single pass over the longer string, bailing at the second mismatch —
 * O(n), no allocation.
 */
function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (long.length < NEAR_DUPLICATE_MIN_LENGTH) return false;
    if (long.length - short.length > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < short.length && j < long.length) {
        if (short[i] === long[j]) {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if (edits > 1) return false;
        // Equal lengths → the mismatch can only be a substitution (advance
        // both); otherwise it's an insertion in the longer one (advance it
        // alone and re-test the same short char).
        if (short.length === long.length) i += 1;
        j += 1;
    }
    return edits + (long.length - j) <= 1;
}

/**
 * Recent searches first, then curated fallbacks, capped at `target`.
 * Normalized on the way through — trimmed, inner whitespace collapsed — and
 * deduped case-insensitively AND against near-duplicates (`withinOneEdit`),
 * so a query typed twice with a typo shows up once, keeping the first (most
 * recent) spelling. Pure — unit-tested without the store/localStorage above.
 *
 * The seed source is the ONE place this is done: every surface that renders
 * seeds (the SERP-ask screen, the pivot row, `EmptyResults`) reads this
 * list, so none of them needs its own idea of what a duplicate is.
 */
export function resolveSearchSeeds(
    recent: string[],
    curated: string[] = CURATED_SEARCH_SEEDS,
    target = SEED_TARGET,
): string[] {
    const keys: string[] = [];
    const seeds: string[] = [];
    for (const q of [...recent, ...curated]) {
        const normalized = q.trim().replace(/\s+/g, " ");
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (keys.some((k) => withinOneEdit(k, key))) continue;
        keys.push(key);
        seeds.push(normalized);
        if (seeds.length >= target) break;
    }
    return seeds;
}
