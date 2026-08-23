/**
 * Persisted recently-viewed jobs for the signed-in /jobs home.
 *
 * Separate from `openedIds` in page.tsx — that set is session-only and dims
 * rows already read THIS visit. This store survives reloads and backs the
 * "Recently viewed" block on the pristine signed-in landing.
 *
 * Layers mirror `lib/jobs/recent-searches.ts`:
 *   - `rememberRecentlyViewed` — pure fold, unit-tested without a DOM.
 *   - `load/save/clearRecentlyViewed` — localStorage wrappers; any failure
 *     degrades to empty rather than throwing.
 *   - module store — subscribe/snapshot + `recordRecentlyViewedJob`.
 */

export const RECENTLY_VIEWED_KEY = "interview-os-recently-viewed";
const DEFAULT_MAX = 8;

export type RecentlyViewedJob = {
    id: string;
    title: string;
    company: string;
};

function isRecentlyViewedJob(value: unknown): value is RecentlyViewedJob {
    if (typeof value !== "object" || value == null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.id === "string" && typeof v.title === "string" && typeof v.company === "string";
}

/**
 * Fold a newly opened job into `list`, newest-first, deduped by id, capped
 * at `max`. Empty id is ignored — nothing to open or link back to.
 */
export function rememberRecentlyViewed(
    list: RecentlyViewedJob[],
    entry: RecentlyViewedJob,
    max = DEFAULT_MAX,
): RecentlyViewedJob[] {
    const id = entry.id.trim();
    if (!id) return list;
    const normalized: RecentlyViewedJob = {
        id,
        title: entry.title.trim() || "Untitled role",
        company: entry.company.trim() || "Unknown company",
    };
    const rest = list.filter((item) => item.id !== id);
    return [normalized, ...rest].slice(0, max);
}

function hasLocalStorage(): boolean {
    return typeof localStorage !== "undefined";
}

export function loadRecentlyViewed(): RecentlyViewedJob[] {
    if (!hasLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isRecentlyViewedJob).slice(0, DEFAULT_MAX);
    } catch {
        return [];
    }
}

export function saveRecentlyViewed(list: RecentlyViewedJob[]): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
    } catch {
        /* ignore quota errors */
    }
}

export function clearRecentlyViewed(): void {
    if (!hasLocalStorage()) return;
    try {
        localStorage.removeItem(RECENTLY_VIEWED_KEY);
    } catch {
        /* ignore */
    }
}

const EMPTY_RECENTLY_VIEWED: RecentlyViewedJob[] = [];
let recentlyViewedCache: RecentlyViewedJob[] | null = null;
const recentlyViewedListeners = new Set<() => void>();

function notifyRecentlyViewedChanged(): void {
    recentlyViewedListeners.forEach((cb) => cb());
}

export function subscribeRecentlyViewed(onChange: () => void): () => void {
    recentlyViewedListeners.add(onChange);
    return () => recentlyViewedListeners.delete(onChange);
}

export function getRecentlyViewedSnapshot(): RecentlyViewedJob[] {
    if (recentlyViewedCache == null) recentlyViewedCache = loadRecentlyViewed();
    return recentlyViewedCache;
}

export function getRecentlyViewedServerSnapshot(): RecentlyViewedJob[] {
    return EMPTY_RECENTLY_VIEWED;
}

/** Record a job the searcher opened — same click path as `openedIds`. */
export function recordRecentlyViewedJob(entry: RecentlyViewedJob): void {
    const current = getRecentlyViewedSnapshot();
    const next = rememberRecentlyViewed(current, entry);
    if (next.length === current.length && next.every((v, i) => v.id === current[i]?.id)) return;
    recentlyViewedCache = next;
    saveRecentlyViewed(next);
    notifyRecentlyViewedChanged();
}
