/**
 * Non-overlapping age-bucket classification for the /trends "Posting
 * freshness" band — a market-wide distribution of ACTIVE postings by how
 * long ago they were posted (`posted_ts`, epoch ms — see meilisearch.ts's
 * `derivePostedTs`/`BUCKET_MS` for confirmation of the unit).
 *
 * Deliberately separate from `BUCKET_MS` (meilisearch.ts): that map drives
 * the /jobs search filter UI's CUMULATIVE "posted within Xd" windows — a
 * different concern (narrowing a search down). This module buckets a single
 * posting into exactly ONE of four disjoint ranges for a market-wide
 * histogram — one concern per module (writing-lean-code rule 4).
 *
 * Pure, DOM-free — unit-testable without a network call.
 */

export const FRESHNESS_BUCKETS = ["7d", "30d", "60d", "older"] as const;
export type FreshnessBucket = (typeof FRESHNESS_BUCKETS)[number];

const DAY_MS = 86_400_000;
const SEVEN_D_MS = 7 * DAY_MS;
const THIRTY_D_MS = 30 * DAY_MS;
const SIXTY_D_MS = 60 * DAY_MS;

/**
 * Pure: which disjoint bucket does a posting fall into, given its
 * `posted_ts` and the current clock (both epoch ms)? Boundaries are
 * INCLUSIVE on the near edge — a posting exactly 7 days old is still "7d",
 * not "30d" — and `postingAgeFilterClauses` below uses the exact same
 * boundaries, so the pure classifier and the live Meilisearch filter can
 * never disagree about where an edge falls.
 */
export function classifyPostingAgeBucket(postedTs: number, nowMs: number): FreshnessBucket {
  const ageMs = nowMs - postedTs;
  if (ageMs <= SEVEN_D_MS) return "7d";
  if (ageMs <= THIRTY_D_MS) return "30d";
  if (ageMs <= SIXTY_D_MS) return "60d";
  return "older";
}

/**
 * Thin I/O-adjacent step: the Meilisearch range-filter clauses that select
 * a bucket, against the SAME boundaries `classifyPostingAgeBucket` uses.
 * Combine with a `vacancy_status = "active"` clause at the call site — this
 * module only knows about posting age, not vacancy state (one concern).
 */
export function postingAgeFilterClauses(bucket: FreshnessBucket, nowMs: number): string[] {
  switch (bucket) {
    case "7d":
      return [`posted_ts >= ${nowMs - SEVEN_D_MS}`];
    case "30d":
      return [`posted_ts < ${nowMs - SEVEN_D_MS}`, `posted_ts >= ${nowMs - THIRTY_D_MS}`];
    case "60d":
      return [`posted_ts < ${nowMs - THIRTY_D_MS}`, `posted_ts >= ${nowMs - SIXTY_D_MS}`];
    case "older":
      return [`posted_ts < ${nowMs - SIXTY_D_MS}`];
  }
}
