/**
 * The one place a {@link CompanyFacts} number becomes a sentence. The page
 * sections and the FAQ both read these, so a figure is worded once. Counts
 * only for multi-valued facets (`stated === null`): their buckets overlap, so
 * a share would be invented.
 */
import type { Distribution } from "./company-facts";
import { formatCount } from "@/lib/format";

export const topBuckets = (d: Distribution, n: number) => d.buckets.slice(0, n);

/** "of 1,240 listings that state a work mode", or null for a multi-valued facet. */
export function statedOfTotal(d: Distribution, noun: string): string | null {
  return d.stated == null ? null : `of ${formatCount(d.stated)} listings that state ${noun}`;
}

/** "listed in 312 postings": a facet count, which may count a re-posted role twice. */
export const listedOnPostings = (count: number) => `listed in ${formatCount(count)} posting${count === 1 ? "" : "s"}`;

/** "listed on 312 roles": a count over the page's own deduped roles. */
export const listedOnRoles = (count: number) => `listed on ${formatCount(count)} role${count === 1 ? "" : "s"}`;

export const roleCountText = (count: number, isLowerBound: boolean) =>
  `${formatCount(count)}${isLowerBound ? "+" : ""} open role${count === 1 && !isLowerBound ? "" : "s"}`;

export const ofStatedSentence = (count: number, d: Distribution, noun: string) =>
  `${formatCount(count)} ${statedOfTotal(d, noun) ?? ""}`.trim();
