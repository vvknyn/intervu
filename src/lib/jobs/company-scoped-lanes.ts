import type { JobSearchParams } from "./types";

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
