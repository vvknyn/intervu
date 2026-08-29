/**
 * Pure decision layer for "has this job been viewed" — no I/O, no React, no
 * Firestore. Two chokepoints:
 *
 *   - `buildViewedSet` merges the three places "viewed" can live (server
 *     `job_views` rows, this-session `openedIds`, the localStorage
 *     recently-viewed store) into one Set, so every consumer (the SERP
 *     dim/opened styling, the hide-viewed filter) agrees on membership.
 *   - `applyViewedFilter` is the hide-viewed toggle itself, factored out of
 *     `jobs/page.tsx`'s `hits` memo so it's unit-testable without mounting
 *     the SERP page.
 */

export function buildViewedSet(
    serverIds: Iterable<string>,
    localIds: Iterable<string>,
    sessionIds: Iterable<string>,
): Set<string> {
    const set = new Set<string>();
    for (const id of serverIds) set.add(id);
    for (const id of localIds) set.add(id);
    for (const id of sessionIds) set.add(id);
    return set;
}

export function applyViewedFilter<T extends { id: string }>(
    hits: T[],
    viewed: Set<string>,
    hideViewed: boolean,
): T[] {
    if (!hideViewed) return hits;
    return hits.filter((hit) => !viewed.has(hit.id));
}
