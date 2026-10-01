/**
 * The single server-callable search execution shared by `searchJobsAction`,
 * `getDefaultBrowseAction` (both actions/jobs.ts), and the /jobs server page
 * — one Meilisearch round trip for the results themselves, plus (in
 * parallel, `Promise.all`, never serialized after it) the two probes
 * jobs/page.tsx used to fire itself as separate client round trips: the
 * ghost-hidden count (the rail's "N hidden" toggle-row suffix) and the
 * beyond-default-window count (the "more beyond 90 days" affordance).
 * Folding them in here is what turns 3 POSTs/search into 1 — see
 * scratchpad/perf/first-paint-design.md, ADOPT #1.
 */
import { searchJobs as runSearch, type SearchServeMeta } from "./search";
import { isUnavailableJobsResult } from "./result-state";
import { resolveCorpusCount, type CorpusCount } from "./corpus-count";
import type { CountryLookup } from "../geo/ip-country";
import type { JobSearchParams, JobSearchResult } from "./types";
import { DEFAULT_URL_STATE } from "./url-state";

export interface RunJobsSearchContext {
  clientIp?: string;
  countryLookup?: CountryLookup;
  /**
   * Params to compute the ghost-hidden/beyond-window probes against, when
   * they differ from the params the main search itself runs with. Only
   * `getDefaultBrowseAction` needs this: its main query is a fixed, cached,
   * unwindowed shape (no `postedBucket` — see that function's doc comment),
   * but the "beyond 90 days" affordance has always measured against the
   * app's quiet default posted window (`DEFAULT_URL_STATE.postedBucket`)
   * regardless of that — a
   * pre-existing split between "what the pristine landing shows" and "what
   * its probes are scoped to" this preserves rather than collapses out from
   * under the pixel-parity requirement. Every other caller passes the same
   * object it searches with, so its probes describe the search they're
   * actually attached to. Defaults to `params`.
   */
  probeParams?: JobSearchParams;
}

export type JobsSearchWithProbes = JobSearchResult & {
  meta?: SearchServeMeta;
  defaultedLocation?: string;
  remoteAnywhere?: boolean;
  unmatchedPlaceMentions?: string[];
  /** Additive by convention, same as `meta`/`defaultedLocation` above —
   *  always set by `runJobsSearch` itself, but optional here so a caller
   *  that returns early without reaching it (e.g. `searchJobsAction`'s
   *  rate-limit/depth-gate denials, or its id-scoped lookup, which never ran
   *  probes even before this change) isn't forced to fabricate a value.
   *  Honest hidden-ghost count for the rail's toggle row — `null` when the
   *  probe didn't run (ghosts not hidden in the probe basis) or failed.
   *  Mirrors the deleted client probe's `ghostHiddenCount` state exactly. */
  ghostHiddenCount?: number | null;
  /** Corpus size with the default posted window lifted, for the "beyond
   *  90 days" affordance — `null` when the probe didn't run (probe basis
   *  isn't bucketed to the default, "90d") or failed. Mirrors the deleted client probe's
   *  `beyondWindowCount` state exactly (its `undefined`/"pending" state no
   *  longer exists once this is server-resolved before the client ever
   *  sees the search result). */
  beyondWindowCount?: CorpusCount | null;
};

type SearchCtx = Pick<RunJobsSearchContext, "clientIp" | "countryLookup">;

export interface ProbePlan {
  ghost: boolean;
  beyondWindow: boolean;
}

/**
 * Pure decision: which of the two probes should run for a given probe basis
 * — unit-testable without touching Meilisearch, same pure-decision/thin-I/O
 * split as `checkRateLimitWindow`/`allowSearchRequest` (lib/shield/rate-limit.ts)
 * and `resolveDegradedServe`/`getDegradedServe` (lib/jobs/search-cache.ts).
 * Mirrors exactly what page.tsx's main search effect used to gate the two
 * client-fired probes on: the ghost probe when `hideGhosts` is true, the
 * beyond-window probe when `postedBucket` is exactly the default window
 * (`DEFAULT_URL_STATE.postedBucket`, "90d" since 2026-09-30; "30d" before),
 * not merely truthy — an explicit narrower pick like "30d"/"7d", "any" and
 * undefined all leave the affordance off, matching `resolveBeyondWindow`.
 */
export function planProbes(probeBasis: Pick<JobSearchParams, "hideGhosts" | "postedBucket" | "offset">): ProbePlan {
  // A later page ("load more") never reads either count — they describe the
  // first page's rail — so it skips both rather than paying two extra
  // corpus queries per scroll.
  if ((probeBasis.offset ?? 0) > 0) return { ghost: false, beyondWindow: false };
  return {
    ghost: probeBasis.hideGhosts === true,
    beyondWindow: probeBasis.postedBucket !== undefined && probeBasis.postedBucket === DEFAULT_URL_STATE.postedBucket,
  };
}

/** Same shape+guard as the deleted client probe in jobs/page.tsx: strip any
 *  explicit `ghost_badge` facet, flip `hideGhosts` off, and ask for a single
 *  facet-only hit so the count is against the SAME other filters rather than
 *  a legacy-facet-narrowed set. */
async function probeGhostHiddenCount(basis: JobSearchParams, ctx: SearchCtx): Promise<number | null> {
  try {
    const gr = await runSearch(
      {
        ...basis,
        facets: { ...basis.facets, ghost_badge: undefined },
        hideGhosts: false,
        withFacets: true,
        limit: 1,
        offset: 0,
      },
      ctx,
    );
    if (isUnavailableJobsResult(gr)) return null;
    return gr.facetDistribution?.ghost_badge?.["likely_ghost"] ?? 0;
  } catch {
    return null;
  }
}

/** Same shape+guard as the deleted client probe: lift `postedBucket` to
 *  measure the corpus this same query/facets would match with no date
 *  window; `limit: 0` because only `total` is needed. */
async function probeBeyondWindowCount(basis: JobSearchParams, ctx: SearchCtx): Promise<CorpusCount | null> {
  try {
    const br = await runSearch({ ...basis, postedBucket: undefined, limit: 0, offset: 0 }, ctx);
    if (isUnavailableJobsResult(br)) return null;
    return resolveCorpusCount(br);
  } catch {
    return null;
  }
}

/**
 * Which probes run is decided by `planProbes` above, off the probe basis
 * (`ctx.probeParams ?? params`) — never re-derived from anything else.
 */
export async function runJobsSearch(
  params: JobSearchParams,
  ctx: RunJobsSearchContext = {},
): Promise<JobsSearchWithProbes> {
  const probeBasis = ctx.probeParams ?? params;
  const searchCtx: SearchCtx = { clientIp: ctx.clientIp, countryLookup: ctx.countryLookup };
  const plan = planProbes(probeBasis);

  const [result, ghostHiddenCount, beyondWindowCount] = await Promise.all([
    runSearch(params, searchCtx),
    plan.ghost ? probeGhostHiddenCount(probeBasis, searchCtx) : Promise.resolve(null),
    plan.beyondWindow ? probeBeyondWindowCount(probeBasis, searchCtx) : Promise.resolve(null),
  ]);

  return { ...result, ghostHiddenCount, beyondWindowCount };
}
