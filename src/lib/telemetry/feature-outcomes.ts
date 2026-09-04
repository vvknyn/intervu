/**
 * Position-corrected rates over `intervu.feature_outcomes` — SPEC-2 §5.
 *
 * Rank-1 rows get clicked far more than rank-20 rows regardless of content,
 * so a rate computed over pooled positions measures position, not the
 * feature. `feature_outcomes` therefore keys on (feature, bucket, position)
 * and this module never collapses that key on the way back out: there is
 * exactly ONE exported way to turn rows into a rate
 * (`positionCorrectedRate`), and it always averages per-position rates over
 * a fixed reference distribution before returning anything. The pooled
 * ("uncorrected") number is available only as a labeled field on that same
 * result — never as a standalone function a caller could reach for instead.
 *
 * This module also builds the rows on the way IN, from raw outcome events
 * plus `job_features` (`enumerateFeatureBuckets` / `aggregateFeatureOutcomes`
 * below). `OutcomeEventRow` carries `position` as a required field and
 * `aggregateFeatureOutcomes`'s grouping key always includes it, so there is
 * no exported function anywhere in this module — on either the write path
 * or the read path — that can produce a feature-outcome number without a
 * position attached. Pooling positions is not a mistake this API guards
 * against at runtime; the shape makes it uncompilable.
 */
import type { JobFeatures } from "./features";

export interface FeatureOutcomeRow {
  feature: string;
  bucket: string;
  position: number;
  impressions: number;
  clicks: number;
  applies: number;
}

export type OutcomeMetric = "clicks" | "applies";

export interface PositionCorrectedRate {
  bucket: string;
  /** Position-corrected rate, averaged over the reference distribution. */
  rate: number;
  /** Same rate computed by pooling every position together — the number
   *  SPEC-2 §5 requires to always be rendered with the word "uncorrected". */
  uncorrectedRate: number;
  /** Total impressions actually observed across the rows that fed this. */
  n: number;
  /** How many reference positions had at least one impression. */
  positionsCovered: number;
}

/** Builds a uniform reference distribution over positions `1..count`
 *  (weights sum to 1). Fixed at call time so a corrected number means the
 *  same thing regardless of how positions happened to be distributed on
 *  any given day — the reference is NEVER derived from the input rows. */
export function uniformReferencePositions(count: number): ReadonlyMap<number, number> {
  const weights = new Map<number, number>();
  for (let position = 1; position <= count; position++) weights.set(position, 1 / count);
  return weights;
}

export const DEFAULT_REFERENCE_POSITIONS: ReadonlyMap<number, number> = uniformReferencePositions(20);

/**
 * The only exported way to turn `feature_outcomes` rows into a rate for one
 * bucket. Internally groups by position, computes each position's own rate,
 * and averages those over `referenceWeights` (renormalized to the positions
 * actually observed) — a caller cannot get a number out of this module by
 * summing raw counts across positions, because no exported function does
 * that summation on its own.
 *
 * Returns null when none of the reference positions have any data — refusing
 * a number is the honest answer, not a headline built from zero coverage.
 */
export function positionCorrectedRate(
  rows: readonly FeatureOutcomeRow[],
  bucket: string,
  metric: OutcomeMetric,
  referenceWeights: ReadonlyMap<number, number> = DEFAULT_REFERENCE_POSITIONS,
): PositionCorrectedRate | null {
  const bucketRows = rows.filter((r) => r.bucket === bucket);
  if (bucketRows.length === 0) return null;

  const byPosition = new Map(bucketRows.map((r) => [r.position, r]));

  let weightedRateSum = 0;
  let weightCovered = 0;
  let positionsCovered = 0;
  for (const [position, weight] of referenceWeights) {
    const row = byPosition.get(position);
    if (!row || row.impressions === 0) continue;
    weightedRateSum += (row[metric] / row.impressions) * weight;
    weightCovered += weight;
    positionsCovered++;
  }
  if (weightCovered === 0) return null;

  let totalImpressions = 0;
  let totalMetric = 0;
  for (const row of bucketRows) {
    totalImpressions += row.impressions;
    totalMetric += row[metric];
  }

  return {
    bucket,
    rate: weightedRateSum / weightCovered,
    uncorrectedRate: totalImpressions > 0 ? totalMetric / totalImpressions : 0,
    n: totalImpressions,
    positionsCovered,
  };
}

/* ------------------------- building rows from raw events ------------------------- */

/** Columns on `JobFeatures` that identify or date the row rather than
 *  describe a posting-structure fact — never bucketed as a "feature". */
export const EXCLUDED_FEATURE_COLUMNS: ReadonlySet<keyof JobFeatures> = new Set([
  "job_id",
  "computed_at",
  "first_seen_at",
  "posted_at",
]);

/**
 * Turns one `JobFeatures` value into a bucket label. Dispatches on the
 * value's OWN type, never on the column name — so a column added to
 * `JobFeatures` tomorrow is bucketed correctly without this function
 * changing:
 *  - null/undefined -> null ("not stated" — the caller must drop the pair,
 *    never guess a bucket for a fact the posting didn't state)
 *  - boolean -> "true" | "false"
 *  - string  -> the string verbatim (already categorical, e.g. degree_level,
 *    seniority_word, employment_type, apply_method)
 *  - number  -> an order-of-magnitude range ("0", "1-9", "10-99", ...), so a
 *    salary in the tens of thousands and a years-of-experience count in the
 *    single digits both land in a stable, comparably-sized bucket without a
 *    per-column range table.
 */
export function bucketFeatureValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return "0";
    const magnitude = Math.floor(Math.log10(value));
    const lo = magnitude === 0 ? 1 : 10 ** magnitude;
    const hi = 10 ** (magnitude + 1) - 1;
    return `${lo}-${hi}`;
  }
  return null;
}

export interface FeatureBucket {
  feature: string;
  bucket: string;
}

/**
 * Every (feature, bucket) pair one posting qualifies for — one entry per
 * bucketable column that isn't null. A posting with N stated features
 * contributes to N rows here, never one flattened "profile" row, so each
 * feature's outcome stays independently queryable and a feature the
 * posting never stated contributes to none of them.
 */
export function enumerateFeatureBuckets(features: JobFeatures): FeatureBucket[] {
  const pairs: FeatureBucket[] = [];
  for (const key of Object.keys(features) as (keyof JobFeatures)[]) {
    if (EXCLUDED_FEATURE_COLUMNS.has(key)) continue;
    const bucket = bucketFeatureValue(features[key]);
    if (bucket === null) continue;
    pairs.push({ feature: key, bucket });
  }
  return pairs;
}

export type FeatureOutcomeKind = "impression" | "click" | "apply";

/** One raw behavioural event, already resolved to the job it happened on
 *  and the position that job rendered at. `position` is required (not
 *  optional) so a caller cannot construct an event this module would have
 *  to pool. */
export interface OutcomeEventRow {
  job_id: string;
  position: number;
  kind: FeatureOutcomeKind;
}

/**
 * The only path from raw events to `FeatureOutcomeRow`s. Fans each event
 * out to every (feature, bucket) pair its job qualifies for, at that
 * event's own position, and sums counts per (feature, bucket, position) —
 * matching `intervu.feature_outcomes`'s primary key exactly, so the result
 * upserts directly with no further grouping (and nothing left to pool).
 * Events for a job with no row in `featuresByJobId` are skipped, not
 * counted against an unknown/empty feature set.
 */
export function aggregateFeatureOutcomes(
  events: readonly OutcomeEventRow[],
  featuresByJobId: ReadonlyMap<string, JobFeatures>,
): FeatureOutcomeRow[] {
  const byKey = new Map<string, FeatureOutcomeRow>();
  for (const event of events) {
    const features = featuresByJobId.get(event.job_id);
    if (!features) continue;
    for (const { feature, bucket } of enumerateFeatureBuckets(features)) {
      const key = `${feature}|${bucket}|${event.position}`;
      let row = byKey.get(key);
      if (!row) {
        row = { feature, bucket, position: event.position, impressions: 0, clicks: 0, applies: 0 };
        byKey.set(key, row);
      }
      if (event.kind === "impression") row.impressions++;
      else if (event.kind === "click") row.clicks++;
      else row.applies++;
    }
  }
  return [...byKey.values()];
}
