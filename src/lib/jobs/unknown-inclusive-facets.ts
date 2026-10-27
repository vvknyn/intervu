/**
 * Facets whose rows can carry no value at all: selecting a value returns the
 * rows tagged with it PLUS the rows tagged with the corpus's own "unknown"
 * sentinel (or nothing). Ruling 2026-09-28 20:10 EDT, "Include unknown, rank
 * lower": a seniority filter, manual or pack, must not silently drop the third
 * of the active pool whose level was never derived — and nothing may claim such
 * a row has the level (the fit ranker demotes them, score.ts / ranked.ts).
 *
 * One source of truth for the predicate: `facetFilterClause` is the Meilisearch
 * form (`buildFilter`), `facetValueMatches` the in-memory form
 * (snapshot-preview.ts, test stub) — both read `UNKNOWN_INCLUSIVE_FACETS`.
 * Pure, no I/O.
 */
import type { FacetKey, JobSearchParams, PublicJob } from "./types";

/**
 * Ruling 2026-10-22, "return all search results ranked by relevance and fit":
 * the same holds for work mode and salary. `knownOnly` builds the strict twin
 * of every clause here (known matches only) — `runTieredRetrieval` runs it at
 * full weight beside the inclusive form at a lower one, so unknown rows rank
 * after known ones instead of being dropped (or interleaved).
 */

/** facet key -> its "value was never derived" sentinel. Extend here, nowhere else. */
export const UNKNOWN_INCLUSIVE_FACETS: Partial<Record<FacetKey, string>> = { experience_level: "unknown", work_type: "unknown" };

/** True when `value` means "not derived" for `key` (absent, empty, or the sentinel). */
export function isUnknownFacetValue(key: FacetKey, value: string | null | undefined): boolean {
  const sentinel = UNKNOWN_INCLUSIVE_FACETS[key];
  return sentinel !== undefined && (value == null || value === "" || value.toLowerCase() === sentinel);
}

/** Meilisearch clause for one facet's selected `vals`: OR within the key, plus the unknown rows when the key includes them (unless `knownOnly`). */
export function facetFilterClause(key: FacetKey, vals: readonly string[], knownOnly = false): string {
  const sentinel = knownOnly ? undefined : UNKNOWN_INCLUSIVE_FACETS[key];
  const terms = [...new Set(sentinel === undefined ? vals : [...vals, sentinel])].map((v) => `${key} = ${JSON.stringify(v)}`);
  // The field may be a null or an absent attribute on un-derived rows — the sentinel alone would miss both.
  if (sentinel !== undefined) terms.push(`${key} IS NULL`, `${key} NOT EXISTS`);
  return `(${terms.join(" OR ")})`;
}

/** Meilisearch clause for a salary floor: a posting whose range reaches `min`, plus (unless `knownOnly`) postings that state no salary at all. */
export function salaryMinClause(min: number, knownOnly = false): string {
  const known = `salary_max >= ${min} OR salary_min >= ${min}`;
  if (knownOnly) return `(${known})`;
  const missing = (f: string) => `(${f} IS NULL OR ${f} NOT EXISTS)`;
  return `(${known} OR (${missing("salary_max")} AND ${missing("salary_min")}))`;
}

/** In-memory twin of `facetFilterClause` for a non-empty `vals`; `value` is the row's value for `key`, null when absent. */
export function facetValueMatches(key: FacetKey, value: string | null, vals: readonly string[]): boolean {
  return (value != null && vals.includes(value)) || isUnknownFacetValue(key, value);
}

/**
 * True when the search requested a work_type, experience_level, or salary_min filter
 * and `job` only matched via the unknown-inclusive fallback (its value for that filter
 * was never derived or is "unknown" / null). Confirmed matches must always rank ahead
 * of unknown-inclusive fallback rows across all search lanes and rerankers.
 */
export function hasUnknownRequestedFacet(
  job: Pick<PublicJob, "work_type" | "experience_level" | "salary_min" | "salary_max">,
  params?: Pick<JobSearchParams, "facets" | "salaryMin"> | null,
): boolean {
  if (!params) return false;
  const workVals = params.facets?.work_type;
  if (workVals && workVals.length > 0) {
    const hasExplicitUnknown = workVals.some((v) => v.toLowerCase() === "unknown");
    if (!hasExplicitUnknown && isUnknownFacetValue("work_type", job.work_type)) {
      return true;
    }
  }
  const expVals = params.facets?.experience_level;
  if (expVals && expVals.length > 0) {
    const hasExplicitUnknown = expVals.some((v) => v.toLowerCase() === "unknown");
    if (!hasExplicitUnknown && isUnknownFacetValue("experience_level", job.experience_level)) {
      return true;
    }
  }
  if (typeof params.salaryMin === "number" && params.salaryMin > 0) {
    const hasKnownSalary =
      (typeof job.salary_min === "number" && job.salary_min > 0) ||
      (typeof job.salary_max === "number" && job.salary_max > 0);
    if (!hasKnownSalary) {
      return true;
    }
  }
  return false;
}
