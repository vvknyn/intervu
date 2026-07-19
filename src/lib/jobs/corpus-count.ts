import type { JobSearchResult } from "./types";

/**
 * Mirrors `JOBS_INDEX_SETTINGS.pagination.maxTotalHits` (lib/jobs/meilisearch.ts).
 * Meilisearch caps BOTH `totalHits` and `estimatedTotalHits` at this value —
 * `searchMeili` folds either into `JobSearchResult.total` — so once the real
 * corpus grows past the cap, `total` silently saturates and stops being a
 * trustworthy count: a value of exactly 100,000 is indistinguishable from
 * "the corpus is exactly 100,000" and "the corpus is 1.7 million and this
 * number gave up counting." Verified live: the real corpus is ~1.77M docs
 * (summing the uncapped `ghost_badge` facet distribution), against this
 * 100,000 cap.
 *
 * Kept as this module's own default rather than importing page.tsx's
 * `MAX_REACHABLE` (a client-component constant) — call sites there should
 * still pass `MAX_REACHABLE` explicitly so the two stay a single visible
 * source of truth in that file; this default only exists so the module (and
 * its unit tests) can be used standalone.
 */
export const CORPUS_COUNT_CAP = 100_000;

export type CorpusCount =
    /** A trustworthy count — either genuinely under the cap, or an uncapped
     *  derivation (summed facet counts) that recovers a real number even
     *  though `total` itself saturated. */
    | { kind: "exact"; value: number }
    /** `total` hit the cap and no uncapped source was available to derive a
     *  real number from — the true size beyond this point is UNKNOWN, only
     *  a floor. Never render this as a bare number — see `formatCorpusCount`. */
    | { kind: "floor"; value: number };

/**
 * Resolve an honest count for a `JobSearchResult`. The four sites that used
 * to print `result.total` (or a one-shot-captured copy of it) directly as
 * fact — the search placeholder, the result count, the résumé-upsell card,
 * and the end-of-list line, all in jobs/page.tsx — now resolve through this
 * instead, so a capped value can never masquerade as an exact one.
 *
 * Meilisearch's `facetDistribution` counts are NOT subject to
 * `pagination.maxTotalHits` — only `totalHits`/`estimatedTotalHits` are —
 * so when `total` is capped AND a `ghost_badge` facet distribution came back
 * (every default first-page search requests `withFacets: true`), summing
 * its values recovers the real, uncapped total on the SAME denominator the
 * "hidden ghosts" copy already uses elsewhere on this page. When neither
 * escape hatch applies (no facets on this response — e.g. a `loadMore`-only
 * or facet-less request), this returns a `floor` rather than fabricating
 * precision the backend can't back up.
 */
export function resolveCorpusCount(
    result: Pick<JobSearchResult, "total" | "facetDistribution">,
    cap: number = CORPUS_COUNT_CAP,
): CorpusCount {
    if (result.total < cap) {
        return { kind: "exact", value: result.total };
    }
    const ghostDist = result.facetDistribution?.ghost_badge;
    if (ghostDist) {
        const summed = Object.values(ghostDist).reduce((a, b) => a + b, 0);
        if (summed > 0) return { kind: "exact", value: summed };
    }
    return { kind: "floor", value: cap };
}

/**
 * Render a `CorpusCount` as bare number text — "1,704,771" for an exact
 * count, "100,000+" for a floor (true either way: at least this many).
 * Callers compose this into their own sentence + pluralization, which
 * already vary per site ("Search N roles…", "N roles", "N live roles",
 * "You've reached the end — N roles.").
 */
export function formatCorpusCount(count: CorpusCount): string {
    const n = count.value.toLocaleString();
    return count.kind === "floor" ? `${n}+` : n;
}
