import type { JobSearchParams } from "../types";
import { tidy } from "./consume";
import { parseSalaryTokens } from "./salary";

/**
 * Typed filter words → the same params the filter panel sets ("typing it =
 * clicking it"), consumed from `q` so the Meili query keeps only titles and
 * skills. Same two rules as `applyQueryUnderstanding`: a field the caller
 * already set is an explicit selection and its typed tokens stay in `q`
 * untouched; fragments that name a filter but cannot become one go to
 * `unmatchedQueryMentions`, never silently dropped. Pure.
 */
export function applyTypedFilterTokens(p: JobSearchParams): JobSearchParams {
  let q = (p.q ?? "").trim();
  const next: JobSearchParams = { ...p };

  if (p.salaryMin === undefined) {
    const salary = parseSalaryTokens(q);
    if (salary.salaryMin !== undefined) {
      q = salary.residualQ;
      next.salaryMin = salary.salaryMin;
    }
  }

  return q === (p.q ?? "").trim() ? p : { ...next, q: tidy(q) };
}
