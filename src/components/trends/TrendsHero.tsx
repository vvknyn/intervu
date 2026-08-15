"use client";

import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { Briefcase, ClockCounterClockwise, ShieldWarning } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function TrendsHero({
  liveJobs,
  totalTracked,
  ghostFlaggedLive,
}: {
  liveJobs: CorpusCount;
  totalTracked: CorpusCount;
  ghostFlaggedLive: CorpusCount;
}) {
  const tiles = [
    {
      label: "Live jobs right now",
      value: liveJobs,
      testId: "trends-stat-live",
      icon: <Briefcase size={18} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />,
      badgeCls: "bg-emerald-50 text-emerald-950 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
      numberCls: "text-emerald-950 dark:text-emerald-200",
      href: `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined })}`,
    },
    {
      label: "Postings tracked, all-time",
      value: totalTracked,
      testId: "trends-stat-total",
      icon: <ClockCounterClockwise size={18} weight="duotone" className="text-indigo-700 dark:text-indigo-400" />,
      badgeCls: "bg-indigo-50 text-indigo-950 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800",
      numberCls: "text-slate-900 dark:text-white",
    },
    {
      label: "Flagged likely-ghost, live",
      value: ghostFlaggedLive,
      testId: "trends-stat-ghost",
      icon: <ShieldWarning size={18} weight="duotone" className="text-rose-700 dark:text-rose-400" />,
      badgeCls: "bg-rose-50 text-rose-950 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
      numberCls: "text-rose-950 dark:text-rose-200",
    },
  ];

  return (
    <div data-testid="trends-hero" className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div
          key={tile.testId}
          data-testid={tile.testId}
          className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-card p-5 shadow-xs transition-all duration-150 hover:border-slate-300 hover:shadow-sm dark:border-slate-800"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {tile.label}
            </span>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", tile.badgeCls)}>
              {tile.icon}
            </div>
          </div>
          <p className={cn("mt-3 font-mono text-3xl font-extrabold tracking-tight", tile.numberCls)}>
            {tile.href ? (
              <Link href={tile.href} className="hover:underline">
                {formatCorpusCount(tile.value)}
              </Link>
            ) : (
              formatCorpusCount(tile.value)
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
