import type { PostedBucket, YearsExperienceBucket } from "../types";

/** [upper bound in days, bucket] — the one table both the typed-token parsers and the LLM stage read. */
export const POSTED_BUCKETS: readonly (readonly [number, PostedBucket])[] = [
  [1, "1d"],
  [3, "3d"],
  [7, "7d"],
  [30, "30d"],
  [90, "90d"],
];

/** [upper bound in years, bucket]; the open-ended top bucket is `YEARS_TOP_BUCKET`. */
export const YEARS_BUCKETS: readonly (readonly [number, YearsExperienceBucket])[] = [
  [2, "0-2"],
  [5, "3-5"],
  [10, "6-10"],
];
export const YEARS_TOP_BUCKET: YearsExperienceBucket = "11+";

/** Smallest bucket whose upper bound covers `n`; `fallback` past the last one. */
export function bucketFor<B>(n: number, table: readonly (readonly [number, B])[], fallback?: B): B | undefined {
  return table.find(([max]) => n <= max)?.[1] ?? fallback;
}
