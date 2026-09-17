import { type CorpusCount } from "@/lib/jobs/corpus-count";
import { POPULAR_LOCATION_COUNTRIES } from "@/components/jobs/FilterPanel";

/** Single source of truth for every user-visible "screened for ghost jobs /
 *  postings that aren't really hiring" claim — link the claim, don't just
 *  assert it (front-door E1). */
export const GHOST_RESEARCH_HREF = "/research/ghost-jobs";

/** The screening clause of the provenance claim — its own export (front-door
 *  E1) so a renderer can split `CORPUS_SOURCE_DESCRIPTOR`-derived text on
 *  this exact substring and wrap it in a link to `GHOST_RESEARCH_HREF`,
 *  instead of a second, independently-typed copy of the phrase. */
export const GHOST_SCREENING_CLAUSE = "screened for stale postings";

/** Short forms for the sentence below, keyed by the canonical spelling in
 *  `POPULAR_LOCATION_COUNTRIES`. Any country not listed here (i.e. every
 *  country added going forward) falls back to its full name — the sentence
 *  never breaks, it just doesn't abbreviate that one. */
const COUNTRY_SHORT_NAME: Partial<Record<(typeof POPULAR_LOCATION_COUNTRIES)[number], string>> = {
    "United States": "the US",
    "United Kingdom": "the UK",
};

/** How many countries the sentence names outright before folding the rest
 *  into a plain "more countries" item — never a count (the landing claim
 *  is guarded to state no number; the live-jobs count owns that role, see
 *  "states no count" below). */
const NAMED_COUNTRY_COUNT = 3;

/**
 * R5: the geo clause of the provenance claim, derived from
 * `POPULAR_LOCATION_COUNTRIES` (FilterPanel.tsx) — the same list the mobile
 * location sheet shows — rather than an independently hand-typed set of
 * country names that can drift from what the filters actually cover.
 * Naming all ten in a sentence would read like a legal disclaimer, so it
 * names the first few and folds the rest into a plain "more countries" —
 * `Intl.ListFormat` joins whatever items are present, so this reads
 * naturally whether or not there's a "more countries" or "remote" item.
 */
function geoClause(): string {
    const named = POPULAR_LOCATION_COUNTRIES.slice(0, NAMED_COUNTRY_COUNT).map(
        (c) => COUNTRY_SHORT_NAME[c] ?? c,
    );
    const items = [
        ...named,
        ...(POPULAR_LOCATION_COUNTRIES.length > NAMED_COUNTRY_COUNT ? ["more countries"] : []),
        "remote",
    ];
    return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}

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
    `from companies' own career pages across ${geoClause()}, ${GHOST_SCREENING_CLAUSE}`;

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
