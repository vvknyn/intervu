"use client";

import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { BarRow, TrendSection, type BarRowTone } from "./TrendSection";

const BUCKET_LABELS: Record<FreshnessBucket, string> = {
  "7d": "Under 7 days",
  "30d": "8 – 30 days",
  "60d": "31 – 60 days",
  older: "Over 60 days",
};

// "Over 60 days" wears the receipt's caution color — it's the one bucket
// this section flags, same amber-not-red rule as the posting-check section.
const BUCKET_TONE: Partial<Record<FreshnessBucket, BarRowTone>> = {
  older: "warn",
};

/**
 * Only "7d" maps onto a real board filter. The board's `postedBucket` model
 * is a "posted within N days of now" window with a single "older" cutoff
 * fixed at 30 days (see url-state.ts / meilisearch.ts) — it has no bucket
 * for "8-30 days ago", "31-60 days ago", or an "older than 60 days" cutoff.
 * Linking those to the nearest existing bucket would silently change what
 * "this row" means (e.g. "older" on the board means >30d, not >60d) — a
 * dishonest link is worse than no link, so those three rows stay unlinked.
 */
export function freshnessBucketJobsHref(bucket: FreshnessBucket): string | undefined {
  if (bucket !== "7d") return undefined;
  return `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: "7d" })}`;
}

export function PostingFreshnessBand({
  freshness,
}: {
  freshness: { bucket: FreshnessBucket; count: CorpusCount }[];
}) {
  if (freshness.length === 0) return null;
  const totalValue = freshness.reduce((sum, f) => sum + f.count.value, 0);
  const maxValue = Math.max(...freshness.map((f) => f.count.value), 1);

  return (
    <TrendSection testId="trends-freshness" label="How long roles stay posted" asOf="age of every live posting">
      {freshness.map(({ bucket, count }) => {
        const pct = totalValue > 0 ? Math.round((count.value / totalValue) * 100) : 0;
        return (
          <BarRow
            key={bucket}
            testId={`trends-freshness-${bucket}`}
            label={BUCKET_LABELS[bucket]}
            tone={BUCKET_TONE[bucket]}
            pct={Math.round((count.value / maxValue) * 100)}
            pctLabel={`${pct}%`}
            count={formatCorpusCount(count)}
            href={freshnessBucketJobsHref(bucket)}
          />
        );
      })}
    </TrendSection>
  );
}
