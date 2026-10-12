import type { JobSearchParams, PublicJob } from "./types";

/** True when place clauses and/or a UI work_type facet constrain the request. */
export function hasCompanyLaneConstraints(p: JobSearchParams): boolean {
  const hasPlaces = (p.places?.length ?? 0) > 0;
  const workTypes = (p.facets?.work_type ?? []).filter((v) => v !== "any" && v !== "all");
  return hasPlaces || workTypes.length > 0;
}

export function shouldRunCompanyScopedLanes(companyScoped: boolean, p: JobSearchParams): boolean {
  return companyScoped && hasCompanyLaneConstraints(p);
}

/** Lane merge order is the ranking — sort-integrity guard would flatten it. */
export function shouldSkipSortIntegrityForCompanyLanes(
  companyScoped: boolean,
  p: JobSearchParams,
): boolean {
  return shouldRunCompanyScopedLanes(companyScoped, p);
}

function stripWorkTypeFacet(p: JobSearchParams): JobSearchParams {
  if (!p.facets?.work_type?.length) return p;
  const { work_type: _wt, ...restFacets } = p.facets;
  return { ...p, facets: Object.keys(restFacets).length > 0 ? restFacets : undefined };
}

function stripPlaceWorkTypes(p: JobSearchParams): JobSearchParams {
  if (!p.places?.some((c) => c.workTypes?.length)) return p;
  return {
    ...p,
    places: p.places.map(({ workTypes: _wt, ...clause }) => clause),
  };
}

function stripPlaces(p: JobSearchParams): JobSearchParams {
  if (!p.places?.length) return p;
  const { places: _places, ...rest } = p;
  return rest;
}

function laneDedupKey(p: JobSearchParams): string {
  const workTypes = (p.facets?.work_type ?? [])
    .filter((v) => v !== "any" && v !== "all")
    .slice()
    .sort();
  const places = (p.places ?? []).map((c) => ({
    any: c.any,
    scopedToCountry: c.scopedToCountry,
    workTypes: c.workTypes?.slice().sort(),
  }));
  return JSON.stringify({ workTypes, places });
}

/** Lane params for employer + place/work-mode ranking — skips identical lanes. */
export function buildCompanyScopedSearchLanes(p: JobSearchParams): JobSearchParams[] {
  const noWorkType = stripWorkTypeFacet(stripPlaceWorkTypes(p));
  const noPlaces = stripPlaces(p);
  const pinOnly = stripPlaces(noWorkType);

  const ordered = [p, noWorkType, noPlaces, pinOnly];
  const seen = new Set<string>();
  const lanes: JobSearchParams[] = [];
  for (const lane of ordered) {
    const key = laneDedupKey(lane);
    if (seen.has(key)) continue;
    seen.add(key);
    lanes.push(lane);
  }
  return lanes;
}

/** One lane's fetch: the rows it returned, and how many rows it matches in all. */
export interface CompanyLaneFetch {
  params: JobSearchParams;
  hits: PublicJob[];
  total: number;
}

export interface CompanyLanePool {
  /** Deduped, in lane-priority order: rows in the requested place lead. */
  hits: PublicJob[];
  /** How many leading rows (of `total`) are in the requested place; absent when no place was asked for. */
  inPlace?: number;
  /** What the search matches, not what one fetch held. */
  total: number;
  /** Lane that serves the rows past `hits` (excluding their ids); absent when `hits` holds every match. */
  tail?: JobSearchParams;
}

const laneHoldsEveryMatch = (lane: CompanyLaneFetch) => lane.hits.length >= lane.total;
const laneKeepsPlace = (lane: CompanyLaneFetch) => (lane.params.places?.length ?? 0) > 0;

/**
 * Pure: turns the lane fetches (narrowest first, as `buildCompanyScopedSearchLanes`
 * orders them) into one list, an honest total, and — when one fetch could not
 * hold every match — the lane that serves the rest.
 *
 * Place is a ranking preference for an employer search, not a filter: the lane
 * ladder (#396) keeps the employer's rows from elsewhere behind the ones in
 * the place. So rows from place-keeping lanes come first, ranked among
 * themselves, and `inPlace` says where they end. A global rerank would
 * interleave them with rows from elsewhere and leave nothing to label.
 *
 * When the place alone holds more rows than a fetch, the list stays in the
 * place and pages on through it; rows from elsewhere only follow once the
 * place has none left to show.
 */
export function assembleCompanyLanePool(
  lanes: CompanyLaneFetch[],
  rank: (hits: PublicJob[]) => PublicJob[],
): CompanyLanePool {
  const seen = new Set<string>();
  const take = (group: CompanyLaneFetch[]): PublicJob[] => {
    const fresh: PublicJob[] = [];
    for (const hit of group.flatMap((lane) => lane.hits)) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      fresh.push(hit);
    }
    return rank(fresh);
  };

  const placed = lanes.filter(laneKeepsPlace);
  const staysInPlace = placed.length > 0 && !laneHoldsEveryMatch(placed[placed.length - 1]);
  const group = staysInPlace ? placed : lanes;
  const inPlaceHits = take(placed);
  const hits = [...inPlaceHits, ...take(group.filter((lane) => !placed.includes(lane)))];
  const widest = group[group.length - 1];
  const complete = laneHoldsEveryMatch(widest);
  const total = complete ? hits.length : widest.total;
  return {
    hits,
    ...(placed.length > 0 && { inPlace: staysInPlace ? total : inPlaceHits.length }),
    total,
    ...(!complete && { tail: widest.params }),
  };
}

/**
 * Pure: the slice of the tail lane a page needs when the pooled `hits` run
 * out before the page does — where it starts and how many rows it owes.
 * Null when the pool covers the page.
 */
export function companyLaneTailWindow(
  poolSize: number,
  offset: number,
  limit: number,
): { offset: number; limit: number } | null {
  const owed = offset + limit - Math.max(offset, poolSize);
  return owed > 0 ? { offset: Math.max(0, offset - poolSize), limit: owed } : null;
}
