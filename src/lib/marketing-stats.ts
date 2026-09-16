import { type CorpusCount } from "@/lib/jobs/corpus-count";

/**
 * The honest-market claim's factual core — source provenance + ghost
 * screening. Single source of truth: the landing claim sentence and the
 * footer's one-line descriptor both read this exact phrase rather than
 * drifting into two independently-edited wordings of the same fact.
 *
 * Never says "scraped" — that's the ingestion engine's own vocabulary, not
 * something a job seeker reads (2026-08-21 front-door audit, item 1). "from
 * companies' own career pages" states the same fact from the seeker's side.
 */
export const CORPUS_SOURCE_DESCRIPTOR =
    "from companies' own career pages across the US, Canada and remote, screened for stale postings";

/**
 * Numbers the landing claim can render when available. Sourced from the same
 * aggregation `/trends` runs (`fetchMarketTrends`) — never a hardcoded count
 * that would rot as the corpus grows.
 */
export interface MarketingCorpusStats {
    liveJobs: CorpusCount;
}

/**
 * The landing masthead's honest-market claim. Provenance only — it states
 * WHERE the roles come from and never HOW MANY.
 *
 * It used to open with the live count. Once the count moved to its own linked
 * line directly above the search box (2026-08-24, Vivek), the same figure was
 * on screen twice about 90px apart, and the two could disagree the moment one
 * of them was fetched and the other wasn't. The count belongs to the count
 * line, which links to /trends and degrades to absent when unknown; this
 * sentence carries the part the count can't say. A constant, not a function of
 * stats, so the duplication cannot be reintroduced by passing an argument.
 */
export const LANDING_PROVENANCE_LINE = `Every live role is ${CORPUS_SOURCE_DESCRIPTOR}.`;

/** Site footer's one-line provenance claim — same fact as the landing claim,
 *  one source. The old footer sentence ended "…Same market your agent sees
 *  via MCP." — machinery language on every guest page; dropped 2026-08-07
 *  (docs/specs/2026-08-07-job-seeker-front-door-design.md). */
export const FOOTER_PROVENANCE_LINE = `Every listing is ${CORPUS_SOURCE_DESCRIPTOR}. Never resold, never curated.`;
