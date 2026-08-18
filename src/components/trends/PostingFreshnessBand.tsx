"use client";

import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { Clock } from "@phosphor-icons/react";

const BUCKET_LABELS: Record<FreshnessBucket, string> = {
  "7d": "Under 7 days",
  "30d": "8 – 30 days ago",
  "60d": "31 – 60 days ago",
  older: "Over 60 days",
};

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
    <section data-testid="trends-freshness" className="rounded-none border border-border bg-card p-6 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground/70">
            <Clock size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Posting Freshness Profile</h2>
            <p className="text-xs text-muted-foreground">Distribution of active openings by elapsed time since publication</p>
          </div>
        </div>
        <span className="hidden text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          Age Decay
        </span>
      </div>

      <ol className="mt-4 space-y-1.5">
        {freshness.map(({ bucket, count }) => {
          const href = freshnessBucketJobsHref(bucket);
          const pct = totalValue > 0 ? Math.round((count.value / totalValue) * 100) : 0;
          return (
            <li
              key={bucket}
              data-testid={`trends-freshness-${bucket}`}
              className="group flex items-center gap-3 px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1 truncate">
                {href ? (
                  <Link
                    href={href}
                    className="font-medium text-foreground hover:text-brand"
                  >
                    {BUCKET_LABELS[bucket]}
                  </Link>
                ) : (
                  <span className="font-medium text-muted-foreground">{BUCKET_LABELS[bucket]}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="h-1.5 w-24 overflow-hidden rounded-none bg-muted/80 sm:w-36">
                  <span
                    className="block h-full rounded-none bg-slate-700 dark:bg-slate-300 transition-all"
                    style={{ width: `${(count.value / maxValue) * 100}%` }}
                  />
                </span>
                <span className="w-10 text-right text-[11px] text-muted-foreground tabular-nums">
                  {pct}%
                </span>
                <span className="w-16 text-right text-xs font-bold text-foreground tabular-nums">
                  {formatCorpusCount(count)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
