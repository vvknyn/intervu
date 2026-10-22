import type { JobSearchParams } from "../types";
import { tidy } from "./consume";
import { parseExclusionTokens } from "./exclusions";
import { parseEmploymentTypeTokens } from "./employment-type";
import { parsePostedWindowTokens } from "./posted-window";
import { parseSalaryTokens } from "./salary";
import { parseYearsTokens } from "./years";

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
  const mentions: string[] = [];

  if (p.salaryMin === undefined) {
    const salary = parseSalaryTokens(q);
    if (salary.salaryMin !== undefined) {
      q = salary.residualQ;
      next.salaryMin = salary.salaryMin;
    }
  }

  if (p.postedBucket === undefined) {
    const posted = parsePostedWindowTokens(q);
    q = posted.residualQ;
    if (posted.postedBucket) next.postedBucket = posted.postedBucket;
    mentions.push(...(posted.mentions ?? []));
  }

  if (p.yearsExperience === undefined) {
    const years = parseYearsTokens(q);
    q = years.residualQ;
    if (years.yearsExperience) next.yearsExperience = years.yearsExperience;
    mentions.push(...(years.mentions ?? []));
  }

  if (!p.facets?.employment_type?.length) {
    const employment = parseEmploymentTypeTokens(q);
    q = employment.residualQ;
    if (employment.employmentTypes.length) {
      next.facets = { ...p.facets, employment_type: employment.employmentTypes };
    }
  }

  const exclusions = parseExclusionTokens(q);
  q = exclusions.residualQ;
  mentions.push(...exclusions.mentions);

  if (mentions.length) next.unmatchedQueryMentions = [...new Set([...(p.unmatchedQueryMentions ?? []), ...mentions])];
  return q === (p.q ?? "").trim() && !mentions.length ? p : { ...next, q: tidy(q) };
}
