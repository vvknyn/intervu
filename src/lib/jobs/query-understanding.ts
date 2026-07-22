/**
 * Deterministic query understanding for jobs search (S1, spec §6.2).
 *
 * Work-arrangement tokens typed in the query become the SAME strict
 * `work_type` facet filter the FilterPanel applies when clicked — "typing it
 * = clicking it". A fixed phrase table, no NLP, so it can never misfire on
 * novel input.
 *
 * Seniority tokens are deliberately NOT parsed into `experience_level`
 * filters: measured live 2026-07-21, the corpus is 76% "mid" (classifier
 * dump bucket), so a seniority filter would DROP correctly-titled senior
 * roles that title-first ranking (see searchMeili's precision pass) already
 * orders correctly.
 *
 * Pure module — no I/O — so behavior locks under unit test.
 */
import type { JobSearchParams } from "./types";

export interface ParsedQuery {
  /** Query text with recognized tokens removed (may be empty). */
  residualQ: string;
  /** Canonical `work_type` facet values implied by the query (corpus vocabulary: remote | hybrid | onsite). */
  workTypes: string[];
}

/** Longest phrases first, so "work from home" is consumed before any single-word pass could see its words. */
const WORK_TYPE_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwork[- ]from[- ]home\b/gi, "remote"],
  [/\bin[- ]office\b/gi, "onsite"],
  [/\bon[- ]site\b/gi, "onsite"],
  [/\bwfh\b/gi, "remote"],
  [/\bremote\b/gi, "remote"],
  [/\bhybrid\b/gi, "hybrid"],
  [/\bonsite\b/gi, "onsite"],
];

export function parseWorkTypeTokens(q: string): ParsedQuery {
  let residual = q;
  const found = new Set<string>();
  for (const [re, canonical] of WORK_TYPE_PHRASES) {
    const next = residual.replace(re, " ");
    if (next !== residual) {
      found.add(canonical);
      residual = next;
    }
  }
  return { residualQ: residual.replace(/\s+/g, " ").trim(), workTypes: [...found] };
}

/**
 * Rewrite search params with parsed work-type tokens applied as facets.
 * Explicit UI facet selection always wins: if the user already narrowed
 * `work_type` in the FilterPanel, the typed token is left in the query
 * untouched rather than second-guessing their click.
 */
export function applyQueryUnderstanding(p: JobSearchParams): JobSearchParams {
  const q = (p.q ?? "").trim();
  if (!q) return p;
  const { residualQ, workTypes } = parseWorkTypeTokens(q);
  if (workTypes.length === 0) return p;
  if (p.facets?.work_type?.length) return p;
  return { ...p, q: residualQ, facets: { ...p.facets, work_type: workTypes } };
}
