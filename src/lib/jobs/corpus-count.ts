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
 * `resolveCorpusCount` for a count that gets cached (`unstable_cache` in
 * actions/jobs.ts). A search that failed (`unavailable`: the index is down)
 * or isn't set up comes back as zero hits, and resolving that would cache an
 * exact 0 for everyone in that country until the entry expires. This throws
 * instead, so nothing is cached and the next request asks the index again.
 */
export function resolveLiveCorpusCount(
    result: Pick<JobSearchResult, "total" | "facetDistribution" | "unavailable"> & { configured?: boolean },
    cap: number = CORPUS_COUNT_CAP,
): CorpusCount {
    if (result.unavailable === true || result.configured === false) {
        throw new Error("search unavailable: no count to cache");
    }
    return resolveCorpusCount(result, cap);
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

/**
 * How many results of `total` the visitor has NOT been shown — the number an
 * anonymous depth wall may honestly quote. Same honesty class as `total`: an
 * exact total yields an exact remainder, a floor total yields a floor
 * remainder (rendered "N+" by `formatCorpusCount`). `null` when nothing is
 * hidden, so a caller can never print "0 more roles".
 */
export function resolveHiddenCount(total: CorpusCount, shown: number): CorpusCount | null {
    const value = total.value - shown;
    return value > 0 ? { kind: total.kind, value } : null;
}

/** Compact approximate count for toolbar/status lines — "~2.1 mil", "~820k". */
export function formatCompactCorpusCount(count: CorpusCount): string {
    const n = count.value;
    const plus = count.kind === "floor" ? "+" : "";
    if (n >= 1_000_000) {
        const mil = Math.round((n / 1_000_000) * 10) / 10;
        return `~${mil} mil${plus}`;
    }
    if (n >= 1_000) {
        return `~${Math.round(n / 1_000)}k${plus}`;
    }
    return `~${n.toLocaleString()}${plus}`;
}

/**
 * The Filters sheet's primary action. Filters apply live, so this only closes the sheet; its label quotes the
 * live total when one has landed (`count` is null while a search is in flight or unavailable) and otherwise
 * says "Show results" rather than a number it cannot back.
 */
export function showResultsLabel(count: CorpusCount | null): string {
    if (!count) return "Show results";
    return `Show ${formatCorpusCount(count)} ${count.kind === "exact" && count.value === 1 ? "job" : "jobs"}`;
}
