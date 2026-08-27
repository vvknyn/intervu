/**
 * How many roles is an employer actually hiring for — and can we prove it?
 *
 * The company page used to answer this with `jobs.length`, the length of its
 * OWN capped hit window (`limit: 200`). Every employer above that cap
 * therefore rendered exactly "200 open roles" as though exact — adyen.com
 * did, live. A window length is a property of the request, not of the
 * employer; it can never be the count.
 *
 * When the fetch is COMPLETE (`result.total < requestedLimit` — strictly
 * below the window, so every matching hit provably came back), the count is
 * instead the caller's own `hitCount`: the length of whatever array the
 * caller actually filtered, deduped, and is about to render. The raw backend
 * `total` counts rows the caller may have already dropped (internal-only
 * postings, re-synced duplicate postings), so it can only ever be >= the
 * caller's true count — treating it as a floor to `Math.max` against (the
 * old behavior) always silently picked the inflated number. Live proof:
 * Stewart's `/co` page stated "66 open roles" (raw `total`) over a rendered
 * list that deduped to 62. A `total` that lands EXACTLY on the limit is
 * deliberately NOT treated as complete: it is indistinguishable from a
 * saturated window that stopped counting right at the cap, so it falls
 * through to the incomplete-fetch branch below, same as a `total` over the
 * limit.
 *
 * `preview` overrides even a complete fetch, though: the snapshot-preview
 * backend serves a capped in-memory slice of the corpus (dev/demo), so its
 * `total` only counts that slice — completeness relative to a fake corpus
 * proves nothing about the real one.
 *
 * Otherwise, when the fetch is INCOMPLETE (more matches exist than were
 * fetched, or the window saturated exactly at the limit) the count falls
 * back to the backend's `total`, resolved through `resolveCorpusCount`
 * (lib/jobs/corpus-count.ts) — the repo's existing exact-vs-floor decision,
 * which already knows that Meilisearch caps `totalHits` at
 * `pagination.maxTotalHits` and that a saturated value is a floor, not a
 * fact. Reusing it keeps "is this count trustworthy?" a single source of
 * truth instead of a second, disagreeing rule on this page. Rows past the
 * fetch window were never retrieved, so they can't be reconciled against the
 * caller's own filtering either — there is no better number to give than the
 * backend's own.
 *
 * `resolveCorpusCount` only knows about that ONE cap, so this adds the two
 * the company page can additionally hit, both of which make `total` itself a
 * floor rather than an exact count in this branch:
 *
 *   - `preview`, same as above.
 *   - a qualified result whose hit window SATURATED. `searchMeili`'s
 *     transitional domain post-filter path (`searchWithDomainPostFilter`)
 *     returns `total = matches found in the scan window only` and early-stops
 *     as soon as it has enough for the requested page — its own comment says
 *     the count is then a lower bound. It always attaches a `note`; the
 *     healthy page-mode path attaches none and returns an EXACT `totalHits`.
 *     So `note` presence is read as "the backend qualified this result" —
 *     presence only, never its wording — and combined with saturation it
 *     means the total cannot be proven. An unsaturated result was fully
 *     enumerated either way, so it stays exact.
 *
 * Failure direction is deliberate: an exact count can be under-claimed as a
 * lower bound ("1,500+" for exactly 1,500), never the reverse. A truncated
 * number presented as fact is the bug being fixed.
 */
import { resolveCorpusCount } from "@/lib/jobs/corpus-count";
import type { JobSearchResult } from "@/lib/jobs/types";

export type OpenCount = {
  value: number;
  /** True when `value` is "at least this many" rather than an exact count. */
  isLowerBound: boolean;
};

export function resolveOpenCount(
  result: Pick<JobSearchResult, "total" | "facetDistribution" | "note" | "preview">,
  hitCount: number,
  requestedLimit: number,
): OpenCount {
  // Fetch complete — see the module doc above for why `hitCount` (not
  // `total`) is the count here. Strictly-less-than: a `total` that lands
  // EXACTLY on the limit is indistinguishable from a saturated window that
  // stopped counting right at the cap (the post-filter early-stop path below
  // produces exactly that shape), so it falls through to the same
  // saturation/note check an over-the-limit `total` gets. `preview` still
  // overrides even a genuinely complete fetch — the snapshot-preview backend
  // serves a capped slice of the corpus, so completeness relative to that
  // slice proves nothing about the real count (see module doc).
  if (result.total < requestedLimit) {
    return { value: hitCount, isLowerBound: result.preview === true };
  }

  // Incomplete fetch — unchanged from before this fix.
  const corpus = resolveCorpusCount(result);
  // Never claim fewer roles than the page is about to list: a post-filter
  // scan can return more matches than its own `total` window accounted for.
  const value = Math.max(corpus.value, hitCount);

  if (result.preview === true) return { value, isLowerBound: true };
  if (corpus.kind === "floor") return { value, isLowerBound: true };

  const saturated = hitCount >= requestedLimit;
  return { value, isLowerBound: saturated && typeof result.note === "string" };
}

/**
 * Should the "Live roles" stat render at all? JobDetail's hiring-truth rail
 * used to trust `job.company_open_count` (a stale, ingest-time aggregate)
 * whenever the live, `companyDomain`-keyed count was `null` — which for
 * guests was ALWAYS, since that fetch used to be gated behind sign-in. A
 * job page can then assert "0 live roles" for a company while the page
 * itself IS one of that company's live roles — a self-contradiction, not an
 * honest zero.
 *
 * Suppress only that contradiction: an open count of 0 while the CURRENT
 * job is not closed (`vacancy_status !== "closed"`, this repo's existing
 * liveness signal — see JobDetail.tsx's own comment and
 * `/jobs/[slug]`'s `generateMetadata` indexability check). A closed job
 * showing "0 live roles" isn't contradictory — the posting itself agrees
 * it's no longer live — so that case renders normally. Any nonzero count
 * never suppresses, regardless of job status.
 */
export function shouldSuppressOpenCount(openCount: number, jobIsClosed: boolean): boolean {
  return openCount === 0 && !jobIsClosed;
}
