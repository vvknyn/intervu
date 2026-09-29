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
import type { FacetKey } from "./types";

/** facet key -> its "value was never derived" sentinel. Extend here, nowhere else. */
export const UNKNOWN_INCLUSIVE_FACETS: Partial<Record<FacetKey, string>> = { experience_level: "unknown" };

/** True when `value` means "not derived" for `key` (absent, empty, or the sentinel). */
export function isUnknownFacetValue(key: FacetKey, value: string | null | undefined): boolean {
  const sentinel = UNKNOWN_INCLUSIVE_FACETS[key];
  return sentinel !== undefined && (value == null || value === "" || value.toLowerCase() === sentinel);
}

/** Meilisearch clause for one facet's selected `vals`: OR within the key, plus the unknown rows when the key includes them. */
export function facetFilterClause(key: FacetKey, vals: readonly string[]): string {
  const sentinel = UNKNOWN_INCLUSIVE_FACETS[key];
  const terms = [...new Set(sentinel === undefined ? vals : [...vals, sentinel])].map((v) => `${key} = ${JSON.stringify(v)}`);
  // The field may be a null or an absent attribute on un-derived rows — the sentinel alone would miss both.
  if (sentinel !== undefined) terms.push(`${key} IS NULL`, `${key} NOT EXISTS`);
  return `(${terms.join(" OR ")})`;
}

/** In-memory twin of `facetFilterClause` for a non-empty `vals`; `value` is the row's value for `key`, null when absent. */
export function facetValueMatches(key: FacetKey, value: string | null, vals: readonly string[]): boolean {
  return (value != null && vals.includes(value)) || isUnknownFacetValue(key, value);
}
