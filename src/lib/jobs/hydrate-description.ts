import { randomUUID } from "node:crypto";
import { createMmdbCountryLookup } from "@/lib/geo/ip-country";
import { searchJobs as runSearch } from "@/lib/jobs/search";
import type { JobSearchResult } from "@/lib/jobs/types";
import {
  DESCRIPTION_FILL_VISIBLE_DEADLINE_MS,
  mergeDescriptionFills,
  planDescriptionFill,
} from "@/lib/jobs/fill-description";
import { fillVisibleDescriptions, hasSubspaceApiKey, isSubspaceTimeout } from "@/lib/jobs/subspaceJobs";

/**
 * Single mmdb country-lookup instance for `hydrateJobDescription` below AND
 * for actions/jobs.ts's other search entry points (`getDefaultBrowseAction`,
 * `countNewSinceAction`), which import it from here. A real reader
 * memory-maps a GeoIP file for the life of the process (see
 * `createMmdbCountryLookup`'s own doc comment in lib/geo/ip-country.ts), so
 * it must stay ONE instance app-wide, not one per importer.
 *
 * Lives here rather than in actions/jobs.ts (where it used to be built)
 * because that file starts with `"use server"`, and Next only allows a
 * `"use server"` file to export async functions — a plain value export like
 * this one is illegal there. This module carries no `"use server"`
 * directive, so it can export the value and actions/jobs.ts can import it
 * back.
 */
export const countryLookup = createMmdbCountryLookup();

export type HydrateDescriptionResult = JobSearchResult & {
  searchId: string;
  /** True when the stored description is still a stub AND the live fill hit
   *  its deadline while this request awaited it — the hit's `description`
   *  is whatever we had at that point, not a final answer. */
  descriptionPending?: true;
};

/**
 * The id-scoped hydrate seam: Meili doc lookup for `id`, then — if the
 * stored description is still a stub — await the live Subspace fill up to
 * its deadline (or report the pending shape on timeout). Extracted from
 * `searchJobsAction`'s id path (actions/jobs.ts, 2026-09-18) so both that
 * Server Action AND `GET /api/jobs/[id]/description`
 * (src/app/api/jobs/[id]/description/route.ts) run the exact same logic
 * instead of two copies that can drift.
 *
 * Query shape is fixed at `{ id, limit: 1, offset: 0, hideGhosts: false }` —
 * the same shape every existing id-scoped caller already used before this
 * extraction (verified: `runExistenceCheck`, lib/jobs/result-state.ts,
 * hardcodes this exact object for every `detailFetcher` call, and
 * `searchJobsAction` itself was never called with `id` set to any other
 * shape). `hideGhosts` stays false so a genuinely live likely_ghost posting
 * is still found, not filtered out.
 *
 * Deliberately does NOT gate (rate limit / depth cap) — this is the
 * extracted business logic only, not the shield layer. Each caller applies
 * whatever check already sat in front of the logic this replaced:
 * `searchJobsAction` keeps its existing top-of-function `allowSearchRequest`
 * call for every params shape including id; the route applies its own call
 * to the SAME store (see the route's doc comment for why).
 *
 * `search`/`fillVisibleDescriptions` are injected (default: the real Meili
 * search and the real Subspace fill call) so this stays unit-testable with
 * no real network — same DI-for-testability posture `createDetailFetcher`'s
 * `fetchImpl` param and `runExistenceCheck`'s `search` param already use
 * elsewhere in this PR/codebase (lib/jobs/detail-fetch.ts,
 * lib/jobs/result-state.ts).
 */
export async function hydrateJobDescription(
  id: string,
  ip: string | null,
  deps: { search?: typeof runSearch; fillVisibleDescriptions?: typeof fillVisibleDescriptions } = {},
): Promise<HydrateDescriptionResult> {
  const search = deps.search ?? runSearch;
  const fillDescriptions = deps.fillVisibleDescriptions ?? fillVisibleDescriptions;

  const searchId = randomUUID();
  const result = await search(
    { id, limit: 1, offset: 0, hideGhosts: false },
    { clientIp: ip ?? undefined, countryLookup },
  );

  const fillPlan = planDescriptionFill({ id }, result.hits, result.unavailable);
  if (!hasSubspaceApiKey() || fillPlan.mode !== "await") {
    return { ...result, searchId };
  }

  try {
    const fills = await fillDescriptions(fillPlan.ids, {
      mode: "visible",
      timeoutMs: DESCRIPTION_FILL_VISIBLE_DEADLINE_MS,
    });
    return { ...result, hits: mergeDescriptionFills(result.hits, fills), searchId };
  } catch (e) {
    if (isSubspaceTimeout(e)) {
      console.warn("[jobs-desc-fill] id-hydrate hit the deadline", { searchId, id });
      return { ...result, searchId, descriptionPending: true as const };
    }
    console.error("[jobs-desc-fill] id-hydrate fill failed:", e);
    return { ...result, searchId };
  }
}
