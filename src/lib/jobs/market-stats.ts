/**
 * Reader for the `market_stats` index — corpus-wide totals that the jobs
 * index structurally cannot answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * /trends asked Meilisearch how many postings had closed, using
 * `vacancy_status = "closed"`. The serving index has never held a closed
 * document — the snapshot endpoint filters them out and the reconcile evicts
 * them — so that query returned 0 on every run, forever. Live facets
 * measured 2026-08-12: {"active": 1971746, "unknown": 249574}, closed 0.
 * The page reported "0 closed to date" as a measurement.
 *
 * Closed counts live in Postgres (public_company_stats), which this app has
 * no access to by construction: the intervu container carries only
 * MEILISEARCH_HOST and MEILISEARCH_SEARCH_KEY. So `push-market-stats.mjs`
 * (subspace repo, daily at 07:10) publishes one pre-computed document here,
 * and this module reads it with the search key the app already has.
 *
 * ABSENT IS NOT ZERO
 * ------------------
 * Every failure path returns `null`, never a zeroed object. Callers must
 * omit the claim rather than print a 0 — reintroducing a confident zero
 * through a new pipe is the exact bug this replaced. Same discipline as
 * `resolveCorpusCount`'s `floor` kind (corpus-count.ts): the corpus is
 * allowed to say "I don't know", and the UI is not allowed to round that to
 * a number.
 */
import { host, searchKey } from "./meilisearch";

export const MARKET_STATS_INDEX = "market_stats";
export const MARKET_STATS_DOC_ID = "global";

export interface MarketStats {
  /** Window the closed/opened figures cover. Published ON the document so
   *  this app cannot mislabel a 90-day number as all-time. */
  windowDays: number;
  closed: number;
  opened: number;
  livePostings: number;
  /** How many employers the aggregate actually covers — lets the page scope
   *  its claim instead of implying the whole corpus. */
  companiesTracked: number;
  /** When the SOURCE rollup last ran, not when the doc was delivered. */
  sourceComputedAt: string | null;
}

/** A finite number, or null. Rejects null/""/NaN — `Number(null)` is 0 and IS
 *  finite, so a bare isFinite check would turn a missing total into a 0. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape the raw document, or null if it can't be trusted.
 *
 * Pure, so the "missing field must not become 0" rule is unit-testable
 * without a Meilisearch round trip.
 */
export function parseMarketStatsDoc(doc: unknown): MarketStats | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const closed = num(d.closed_90d);
  const opened = num(d.opened_90d);
  const livePostings = num(d.live_postings);
  const companiesTracked = num(d.companies_tracked);
  const windowDays = num(d.window_days);
  // All-or-nothing: a partially-populated document means the publisher wrote
  // something unexpected, and guessing which half to trust is how a wrong
  // number reaches the page wearing the same styling as a right one.
  if (closed === null || opened === null || livePostings === null) return null;
  if (companiesTracked === null || windowDays === null) return null;
  return {
    windowDays,
    closed,
    opened,
    livePostings,
    companiesTracked,
    sourceComputedAt: typeof d.source_computed_at === "string" ? d.source_computed_at : null,
  };
}

/**
 * Fetch the published totals. Returns null when the index/document is absent
 * (the publisher hasn't run, or its task is still queued) or on any error —
 * /trends renders without the claim rather than with a fabricated one.
 */
export async function fetchMarketStats(): Promise<MarketStats | null> {
  const h = host();
  if (!h) return null;
  try {
    const res = await fetch(`${h}/indexes/${MARKET_STATS_INDEX}/documents/${MARKET_STATS_DOC_ID}`, {
      headers: { authorization: `Bearer ${searchKey()}` },
      // Matches the page's ISR cadence: revalidated with the page, not per visitor.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return parseMarketStatsDoc(await res.json());
  } catch {
    return null;
  }
}
