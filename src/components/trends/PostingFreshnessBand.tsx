import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";

/** Human labels for the four disjoint age buckets — this page is the only
 *  consumer of `FreshnessBucket`, so the label map lives beside its one
 *  render site rather than in the (DOM-free) bucketing module. */
const BUCKET_LABELS: Record<FreshnessBucket, string> = {
  "7d": "Posted in the last 7 days",
  "30d": "8-30 days ago",
  "60d": "31-60 days ago",
  older: "Older than 60 days",
};

/**
 * `FreshnessBucket` (this module's disjoint age classification) and
 * `PostedBucket` (url-state.ts's cumulative "posted within Xd" filter) are
 * different concerns (see posting-age-buckets.ts's module doc) that only
 * provably agree at one boundary: disjoint "7d" (age <= 7d) is the exact
 * same cutoff as cumulative postedBucket "7d". Every other bucket would
 * either overcount (30d, older — both broader than the row they'd be
 * attached to) or has no matching PostedBucket value at all (60d), so they
 * stay unlinked. Exhaustive over the closed union: a bucket value added to
 * the type in the future defaults to unlinked (the safe choice) rather than
 * silently mis-scoping.
 */
export function freshnessBucketJobsHref(bucket: FreshnessBucket): string | undefined {
  if (bucket !== "7d") return undefined;
  return `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: "7d" })}`;
}

/**
 * Posting freshness band — active postings bucketed by age, single-hue
 * proportion bars (same magnitude-encoding idiom as `TopCountriesList`, no
 * new color introduced).
 */
export function PostingFreshnessBand({
  freshness,
}: {
  freshness: { bucket: FreshnessBucket; count: CorpusCount }[];
}) {
  if (freshness.length === 0) return null;
  const maxValue = Math.max(...freshness.map((f) => f.count.value), 1);

  return (
    <section data-testid="trends-freshness" className="mt-10 border-t border-foreground pt-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Posting freshness
      </span>
      <p className="mt-1 text-sm text-muted-foreground">How old the live corpus is, right now.</p>

      <ol className="mt-4 space-y-2">
        {freshness.map(({ bucket, count }) => {
          const href = freshnessBucketJobsHref(bucket);
          return (
            <li key={bucket} data-testid={`trends-freshness-${bucket}`} className="flex items-center gap-3 text-[13.5px]">
              {href ? (
                <Link href={href} className="w-40 shrink-0 text-foreground hover:underline sm:w-48">
                  {BUCKET_LABELS[bucket]}
                </Link>
              ) : (
                <span className="w-40 shrink-0 text-muted-foreground sm:w-48">{BUCKET_LABELS[bucket]}</span>
              )}
              <span className="h-3 flex-1 bg-foreground/10">
                <span className="block h-full bg-foreground/40" style={{ width: `${(count.value / maxValue) * 100}%` }} />
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[12.5px] text-foreground">
                {formatCorpusCount(count)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
