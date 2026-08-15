"use client";

import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FreshnessBucket } from "@/lib/jobs/posting-age-buckets";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { Clock } from "@phosphor-icons/react";

const BUCKET_LABELS: Record<FreshnessBucket, string> = {
  "7d": "Posted in the last 7 days",
  "30d": "8-30 days ago",
  "60d": "31-60 days ago",
  older: "Older than 60 days",
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
  const maxValue = Math.max(...freshness.map((f) => f.count.value), 1);

  return (
    <section data-testid="trends-freshness" className="mt-6 rounded-2xl border border-slate-200/90 bg-card p-6 shadow-xs dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <Clock size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Posting Freshness</h2>
          <p className="text-xs text-muted-foreground">Distribution of active openings by time elapsed since publication</p>
        </div>
      </div>

      <ol className="mt-5 space-y-2.5">
        {freshness.map(({ bucket, count }) => {
          const href = freshnessBucketJobsHref(bucket);
          return (
            <li key={bucket} data-testid={`trends-freshness-${bucket}`} className="flex items-center gap-3 text-[13.5px]">
              {href ? (
                <Link href={href} className="w-40 shrink-0 font-medium text-foreground hover:text-sky-600 dark:hover:text-sky-400 sm:w-48">
                  {BUCKET_LABELS[bucket]}
                </Link>
              ) : (
                <span className="w-40 shrink-0 font-medium text-muted-foreground sm:w-48">{BUCKET_LABELS[bucket]}</span>
              )}
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="block h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${(count.value / maxValue) * 100}%` }} />
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[12.5px] font-bold text-foreground">
                {formatCorpusCount(count)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
