/**
 * "More like this" (JobDetail — Curiosity / Serial Positioning Effect): the
 * detail panel had ZERO related/similar surface, so after reading a posting
 * the only forward path was a gated company link. `getRelatedJobsAction`
 * (actions/jobs.ts) does the actual fetching (company-scoped first, a
 * title-keyword fallback second); this is the pure decision in between —
 * given how many company-scoped hits came back, should the caller widen the
 * search, and to what query?
 */

/**
 * Below this many company-scoped hits (the posting's own job already
 * excluded by the caller), a company alone isn't a real "more like this"
 * list — one other open role at the same company reads as a coincidence,
 * not a set of alternatives worth surfacing.
 */
const MIN_COMPANY_HITS = 2;

/** How many leading significant words a fallback query keeps. */
const MAX_FALLBACK_WORDS = 3;

/**
 * Seniority/qualifier and function words stripped before a title becomes a
 * fallback search query — they narrow toward exact-title matches (or match
 * nothing at all) rather than the adjacent roles a fallback is for. Kept
 * short and title-specific rather than a general-purpose stopword list: the
 * only failure mode this guards is a title that's ALL qualifier words
 * (`resolveRelatedQuery`'s "none" branch), not general search quality.
 */
const TITLE_NOISE_WORDS = new Set([
    "senior", "sr", "jr", "junior", "staff", "principal", "lead", "head",
    "i", "ii", "iii", "iv", "v",
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "at", "on", "with",
]);

/** First `max` significant words in `title` — lowercased, noise-stripped, in
 *  reading order. Exported for its own direct test coverage alongside
 *  `resolveRelatedQuery`. */
export function significantTitleWords(title: string, max: number = MAX_FALLBACK_WORDS): string[] {
    return (title ?? "")
        .toLowerCase()
        .split(/[^a-z0-9+]+/)
        .filter((w) => w.length > 1 && !TITLE_NOISE_WORDS.has(w))
        .slice(0, max);
}

export type RelatedQueryPlan =
    /** Enough company-scoped hits on their own — use them as-is. */
    | { mode: "company" }
    /** Too few (or zero, no domain) company hits — widen to this query. */
    | { mode: "title-fallback"; fallbackQuery: string }
    /** Too few company hits AND the title has no usable keywords to widen
     *  with (e.g. "Senior Staff Lead") — an empty query would search the
     *  whole corpus, which is not "related." Show only the company hits on
     *  hand (even if fewer than `MIN_COMPANY_HITS`), no fabricated fallback. */
    | { mode: "none" };

export function resolveRelatedQuery(input: { companyHitCount: number; title: string }): RelatedQueryPlan {
    if (input.companyHitCount >= MIN_COMPANY_HITS) return { mode: "company" };
    const words = significantTitleWords(input.title);
    if (words.length === 0) return { mode: "none" };
    return { mode: "title-fallback", fallbackQuery: words.join(" ") };
}
