import { EMPLOYMENT_TYPES, type EmploymentType } from "@/lib/agent/facets";
import { replaceOutsideQuotes, tidy } from "./consume";

/** A contract-as-adjective title ("Contract Manager") is a role, not a work arrangement. */
const NOT_A_TITLE_NOUN = String.raw`(?!\s+(?:manager|management|specialist|administrator|negotiator|coordinator|attorney|lawyer|counsel)\b)`;

/**
 * Typed phrase → canonical `employment_type` facet value. The values are
 * typed `EmploymentType`, so a value outside `EMPLOYMENT_TYPES` (the facet's
 * single source of truth) cannot compile. "temporary" has no facet value and
 * stays in the query.
 */
const EMPLOYMENT_PHRASES: ReadonlyArray<readonly [RegExp, EmploymentType]> = [
  [/\bpart[- ]time\b/gi, "part_time"],
  [new RegExp(String.raw`\bcontract(?:or|ors|ing)?\b${NOT_A_TITLE_NOUN}`, "gi"), "contract"],
  [/\bintern(?:ship|ships)?\b/gi, "internship"],
  [/\bfull[- ]time\b/gi, "full_time"],
];

export interface ParsedEmploymentType {
  residualQ: string;
  employmentTypes: EmploymentType[];
}

export function parseEmploymentTypeTokens(q: string): ParsedEmploymentType {
  let residual = q;
  const found = new Set<EmploymentType>();
  for (const [re, canonical] of EMPLOYMENT_PHRASES) {
    residual = replaceOutsideQuotes(residual, re, () => {
      found.add(canonical);
      return " ";
    });
  }
  return { residualQ: tidy(residual), employmentTypes: EMPLOYMENT_TYPES.filter((t) => found.has(t)) };
}
