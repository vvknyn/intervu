import { isDeepStrictEqual } from "node:util";
import type { FilterState } from "@/components/jobs/FilterPanel";
import type { FacetKey, JobSearchParams } from "./types";

/**
 * What the understanding stages read out of the typed words, echoed to the
 * client so it can become ordinary filter state (and so ordinary removable
 * chips). `params` holds ONLY fields the stages set, never ones the caller
 * sent; a place the stages found is expressed the way the typed location box
 * expresses it (`location_country` text) so the server re-resolves it, with
 * any work mode bound to it lifted to the global `work_type` facet.
 */
export interface UnderstoodSearch {
  params: Pick<JobSearchParams, "facets" | "salaryMin" | "postedBucket" | "yearsExperience" | "visaOnly">;
  residualQ: string;
  source: "deterministic" | "llm";
}

const SCALAR_FIELDS = ["salaryMin", "postedBucket", "yearsExperience"] as const;

/** Pure: the fields `after` set that `raw` left unset, or undefined when the stages changed nothing a filter can show. */
export function diffUnderstood(
  raw: JobSearchParams,
  after: JobSearchParams,
  source: UnderstoodSearch["source"],
): UnderstoodSearch | undefined {
  const facets: Partial<Record<FacetKey, string[]>> = {};
  const setFacet = (key: FacetKey, values: string[] | undefined) => {
    if (values?.length && !raw.facets?.[key]?.length) facets[key] = [...new Set([...(facets[key] ?? []), ...values])];
  };
  for (const [key, values] of Object.entries(after.facets ?? {}) as [FacetKey, string[] | undefined][]) setFacet(key, values);
  if (!raw.places?.length) {
    setFacet("location_country", after.places?.flatMap((c) => (c.label ? [c.label] : [])));
    setFacet("work_type", after.places?.flatMap((c) => c.workTypes ?? []));
  }

  const params: UnderstoodSearch["params"] = {};
  if (Object.keys(facets).length) params.facets = facets;
  for (const f of SCALAR_FIELDS) {
    if (raw[f] === undefined && after[f] !== undefined) Object.assign(params, { [f]: after[f] });
  }
  if (!raw.visaOnly && after.visaOnly) params.visaOnly = true;
  return Object.keys(params).length ? { params, residualQ: after.q ?? "", source } : undefined;
}

/** Which stage produced the final params: the LLM stage only if it changed what the deterministic one left. */
export const understoodSource = (deterministic: JobSearchParams, final: JobSearchParams): UnderstoodSearch["source"] =>
  isDeepStrictEqual(deterministic, final) ? "deterministic" : "llm";

/**
 * Pure: fold what the server understood into the page's filter state. Only
 * fields the searcher has not set are written (explicit selection wins), and
 * the SAME state object comes back when nothing was written — that identity
 * is the loop guard: a follow-up search sends these fields explicitly, so the
 * server echoes nothing, and anything still unmergeable changes no state.
 */
export function mergeUnderstood(state: FilterState, p: UnderstoodSearch["params"]): FilterState {
  let next = state;
  const set = (patch: Partial<FilterState>) => {
    next = { ...next, ...patch };
  };
  for (const [key, values] of Object.entries(p.facets ?? {}) as [FacetKey, string[]][]) {
    if (values.length && !state.facets[key]?.length) set({ facets: { ...next.facets, [key]: values } });
  }
  if (p.salaryMin && !state.salaryMin) set({ salaryMin: p.salaryMin });
  if (p.postedBucket && !state.postedExplicit) set({ postedBucket: p.postedBucket, postedExplicit: true });
  if (p.yearsExperience && !state.yearsExperience) set({ yearsExperience: p.yearsExperience });
  if (p.visaOnly && !state.visaOnly) set({ visaOnly: true });
  return next;
}

/** Pure: the one sentence saying what was searched, worded exactly like the chips the merge produced. */
export function understoodLine(
  residualQ: string,
  added: readonly { key: string; label: string }[],
  chipLabel: (entry: { key: string; label: string }) => string,
): string {
  const q = residualQ.trim();
  return ["Searched", q ? `“${q}”` : "all roles", ...added.map(chipLabel)].join(" · ").replace(" · ", " ");
}
