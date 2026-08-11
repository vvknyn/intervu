/**
 * How many roles is an employer actually hiring for — and can we prove it?
 *
 * The company page used to answer this with `jobs.length`, the length of its
 * OWN capped hit window (`limit: 200`). Every employer above that cap
 * therefore rendered exactly "200 open roles" as though exact — adyen.com
 * did, live. A window length is a property of the request, not of the
 * employer; it can never be the count.
 *
 * The count comes from the backend's `total` instead, resolved through
 * `resolveCorpusCount` (lib/jobs/corpus-count.ts) — the repo's existing
 * exact-vs-floor decision, which already knows that Meilisearch caps
 * `totalHits` at `pagination.maxTotalHits` and that a saturated value is a
 * floor, not a fact. Reusing it keeps "is this count trustworthy?" a single
 * source of truth instead of a second, disagreeing rule on this page.
 *
 * `resolveCorpusCount` only knows about that ONE cap, so this adds the two
 * the company page can additionally hit, both of which make `total` itself a
 * floor rather than an exact count:
 *
 *   - `preview` — the snapshot-preview backend serves a capped in-memory
 *     slice of the corpus (dev/demo), so its `total` counts the slice.
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
  const corpus = resolveCorpusCount(result);
  // Never claim fewer roles than the page is about to list: a post-filter
  // scan can return more matches than its own `total` window accounted for.
  const value = Math.max(corpus.value, hitCount);

  if (result.preview === true) return { value, isLowerBound: true };
  if (corpus.kind === "floor") return { value, isLowerBound: true };

  const saturated = hitCount >= requestedLimit;
  return { value, isLowerBound: saturated && typeof result.note === "string" };
}
