import type { PostedBucket } from "../types";
import { POSTED_BUCKETS, bucketFor } from "./buckets";
import { replaceOutsideQuotes, tidy } from "./consume";

const NUMBER_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

const N = String.raw`(\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten)`;
const UNIT = String.raw`(day|week|month)s?`;
const LEAD = String.raw`(?:posted\s+)?(?:(?:in|within)\s+)?(?:the\s+)?`;
/** [pattern, fixed days]; the counted forms carry N and UNIT in groups 1 and 2. */
const COUNTED = [
  new RegExp(String.raw`\b${LEAD}(?:last|past)\s+(?:${N}\s+)?${UNIT}\b`, "gi"),
  new RegExp(String.raw`\bposted\s+within\s+${N}\s+${UNIT}\b`, "gi"),
];
const FIXED: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:posted\s+)?(?:today(?![\w'’])|in\s+the\s+last\s+24\s+hours\b)/gi, 1],
  [/\b(?:posted\s+)?this\s+week\b/gi, 7],
  [/\b(?:posted\s+)?this\s+month\b/gi, 30],
];

export interface ParsedPostedWindow {
  residualQ: string;
  postedBucket?: PostedBucket;
  /** A window longer than the widest bucket cannot be a filter; the phrase is reported, not searched as words. */
  mentions?: string[];
}

/**
 * "today", "this week", "past week", "last 7 days", "last 2 weeks": the
 * smallest age bucket covering the window. "recent" alone is not a window.
 */
export function parsePostedWindowTokens(q: string): ParsedPostedWindow {
  let days: number | undefined;
  let tooLong: string | undefined;
  const take = (d: number, phrase: string): string => {
    if (days !== undefined || tooLong !== undefined) return phrase;
    if (bucketFor(d, POSTED_BUCKETS)) days = d;
    else tooLong = `posted within ${phrase.trim()}`;
    return " ";
  };
  let residual = q;
  for (const re of COUNTED) {
    residual = replaceOutsideQuotes(residual, re, (match, n, unit) =>
      take((n ? (NUMBER_WORDS[n.toLowerCase()] ?? Number(n)) : 1) * UNIT_DAYS[unit.toLowerCase()], match),
    );
  }
  for (const [re, d] of FIXED) residual = replaceOutsideQuotes(residual, re, (match) => take(d, match));
  return {
    residualQ: tidy(residual),
    ...(days !== undefined && { postedBucket: bucketFor(days, POSTED_BUCKETS) }),
    ...(tooLong !== undefined && { mentions: [tooLong] }),
  };
}
