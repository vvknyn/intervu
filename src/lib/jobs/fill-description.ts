import type { JobSearchParams, PublicJob } from "./types";

/** Matches jobs/page.tsx `PAGE` and the Subspace fill-descriptions API cap. */
export const DESCRIPTION_FILL_MAX_IDS = 20;

/** Must stay 220 — mirrors interview-os constants.ts TEASER_MAX_LEN. */
export const TEASER_MAX_LEN = 220;

/** The awaited id-hydrate fill (searchJobsAction's "await" plan). 10 s is the
 *  attention limit for a wait with progress feedback — the "About this role"
 *  section shows a status line after `DESCRIPTION_WAIT_COPY_MS`
 *  (lib/jobs/for-you/description-wait-copy.ts, via `DescriptionLoadingStatus`).
 *  The scrape
 *  continues server-side and is persisted past this deadline, so a later
 *  reopen/"Try again" gets it cheaply rather than re-running the ladder. */
export const DESCRIPTION_FILL_VISIBLE_DEADLINE_MS = 10_000;

/** The background SERP prefetch (`after()`) — bounded only so a hung socket
 *  can't linger; nothing in the request path waits on this. */
export const DESCRIPTION_FILL_PREFETCH_DEADLINE_MS = 60_000;

/** True when Meili body is a teaser stub (same class as interview-os isTeaserDescription). */
export function descriptionNeedsFill(description: string | null | undefined): boolean {
  if (description == null || description.trim() === "") {
    return true;
  }
  const trimmed = description.trimEnd();
  if (trimmed.length < TEASER_MAX_LEN) {
    return true;
  }
  return trimmed.endsWith("...") || trimmed.endsWith("…");
}

export type DescriptionFillPlan =
  | { mode: "none"; ids: [] }
  | { mode: "prefetch"; ids: string[] }
  | { mode: "await"; ids: [string] };

/**
 * Decide whether to prefetch (SERP) or await-fill (id hydrate) after Meili
 * returns. Pure — no I/O, no API-key check (caller gates on that).
 */
export function planDescriptionFill(
  params: Pick<JobSearchParams, "id">,
  hits: PublicJob[],
  unavailable?: boolean,
): DescriptionFillPlan {
  if (unavailable || hits.length === 0) {
    return { mode: "none", ids: [] };
  }

  if (params.id) {
    const hit = hits[0];
    if (!hit || !descriptionNeedsFill(hit.description)) {
      return { mode: "none", ids: [] };
    }
    return { mode: "await", ids: [hit.id] };
  }

  return {
    mode: "prefetch",
    ids: hits.map((h) => h.id).slice(0, DESCRIPTION_FILL_MAX_IDS),
  };
}

/** Merge non-empty fill responses onto matching hits; unmatched hits pass through. */
export function mergeDescriptionFills(
  hits: PublicJob[],
  fills: Array<{ id: string; description: string | null }>,
): PublicJob[] {
  if (fills.length === 0) return hits;

  const byId = new Map<string, string>();
  for (const fill of fills) {
    if (fill.description != null && fill.description.trim() !== "") {
      byId.set(fill.id, fill.description);
    }
  }
  if (byId.size === 0) return hits;

  return hits.map((h) => {
    const description = byId.get(h.id);
    return description ? { ...h, description } : h;
  });
}
