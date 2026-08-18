import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";

/** Mirrors `PostingFreshnessBand`'s (module-private) bucket copy, kept in
 *  sync by hand — same reasoning as `company-stats.ts`'s `isBuildPhase`
 *  duplication: neither is exported by /trends' modules. */
const BUCKET_LABELS: Record<FreshnessBucket, string> = {
  "7d": "Posted in the last 7 days",
  "30d": "8-30 days ago",
  "60d": "31-60 days ago",
  older: "Older than 60 days",
};

/** This company's posting-age distribution — same bar idiom as the
 *  market-wide `PostingFreshnessBand`, plain counts instead of `CorpusCount`. */
export function CompanyFreshnessBand({
  freshness,
}: {
  freshness: { bucket: FreshnessBucket; count: number }[];
}) {
  const total = freshness.reduce((sum, f) => sum + f.count, 0);
  if (total === 0) return null;
  const maxValue = Math.max(...freshness.map((f) => f.count), 1);

  return (
    <section data-testid="company-freshness" className="mt-8 border-t border-foreground pt-6">
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Posting freshness
      </span>
      <p className="mt-1 text-sm text-muted-foreground">How old this company&apos;s live postings are, right now.</p>

      <ol className="mt-4 space-y-2">
        {freshness.map(({ bucket, count }) => (
          <li
            key={bucket}
            data-testid={`company-freshness-${bucket}`}
            className="flex items-center gap-3 text-[13.5px]"
          >
            <span className="w-40 shrink-0 text-muted-foreground sm:w-48">{BUCKET_LABELS[bucket]}</span>
            <span className="h-1.5 flex-1 bg-foreground/10">
              <span className="block h-full bg-foreground/40" style={{ width: `${(count / maxValue) * 100}%` }} />
            </span>
            <span className="w-12 shrink-0 text-right text-[12.5px] text-foreground">{count}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
