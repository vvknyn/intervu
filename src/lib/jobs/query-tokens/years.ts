import type { YearsExperienceBucket } from "../types";
import { YEARS_BUCKETS, YEARS_TOP_BUCKET, bucketFor } from "./buckets";
import { replaceOutsideQuotes, tidy } from "./consume";

/** Group 1 = a first-person lead ("I have", "I've got"): the searcher's own experience, not the job's requirement. */
const YEARS_RE =
  /(?<!\b(?:last|past)\s)\b(?:(i\s+have|i've\s+got|i've|i\s+got|i'm\s+at)\s+)?(?:(?:at least|min(?:imum)?(?: of)?|over|more than)\s+)?(\d{1,2})(?:\s?-\s?\d{1,2})?\s?\+?\s*(?:years?|yrs?)\b(?:\s+(?:of\s+)?(?:experience|exp)\b)?/gi;

export interface ParsedYears {
  residualQ: string;
  yearsExperience?: YearsExperienceBucket;
  /** First-person phrases: consumed from the query, reported, never a filter. */
  mentions?: string[];
}

/**
 * "8+ years", "5 years", "3-5 yrs", "at least 10 years": the bucket holding
 * the stated floor. "I have 13 years" says what the searcher has, so it is a
 * mention, not a requirement filter.
 */
export function parseYearsTokens(q: string): ParsedYears {
  let floor: number | undefined;
  const mentions: string[] = [];
  const residual = replaceOutsideQuotes(q, YEARS_RE, (match, firstPerson, n) => {
    if (firstPerson) {
      mentions.push(match.trim());
      return " ";
    }
    if (floor !== undefined) return match;
    floor = Number(n);
    return " ";
  });
  return {
    residualQ: tidy(residual),
    ...(floor !== undefined && { yearsExperience: bucketFor(floor, YEARS_BUCKETS, YEARS_TOP_BUCKET) }),
    ...(mentions.length && { mentions }),
  };
}
