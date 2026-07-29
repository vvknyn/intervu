import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";

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
        {freshness.map(({ bucket, count }) => (
          <li key={bucket} data-testid={`trends-freshness-${bucket}`} className="flex items-center gap-3 text-[13.5px]">
            <span className="w-40 shrink-0 text-muted-foreground sm:w-48">{BUCKET_LABELS[bucket]}</span>
            <span className="h-1.5 flex-1 bg-foreground/10">
              <span className="block h-full bg-foreground/40" style={{ width: `${(count.value / maxValue) * 100}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-[12.5px] text-foreground">
              {formatCorpusCount(count)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
