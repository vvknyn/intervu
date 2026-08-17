"use client";

import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { Briefcase, Database, ShieldWarning } from "@phosphor-icons/react";
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
      label: "Live Active Openings",
      subtitle: "Verified direct from employer boards",
      value: liveJobs,
      testId: "trends-stat-live",
      icon: <Briefcase size={16} weight="duotone" className="text-foreground" />,
      indicator: "bg-emerald-500",
      href: `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined })}`,
    },
    {
      label: "Total Postings Tracked",
      subtitle: "Cumulative indexed across all statuses",
      value: totalTracked,
      testId: "trends-stat-total",
      icon: <Database size={16} weight="duotone" className="text-foreground" />,
      indicator: "bg-slate-400 dark:bg-slate-500",
    },
    {
      label: "Ghost-Risk Flagged",
      subtitle: "Flagged by integrity heuristic checks",
      value: ghostFlaggedLive,
      testId: "trends-stat-ghost",
      icon: <ShieldWarning size={16} weight="duotone" className="text-rose-500" />,
      indicator: "bg-rose-500",
    },
  ];

  return (
    <div data-testid="trends-hero" className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div
          key={tile.testId}
          data-testid={tile.testId}
          className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-colors hover:border-border-strong"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", tile.indicator)} aria-hidden />
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                {tile.label}
              </span>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded border border-border bg-muted/40">
              {tile.icon}
            </div>
          </div>
          <div className="mt-3">
            <p className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {tile.href ? (
                <Link href={tile.href} className="hover:text-brand hover:underline">
                  {formatCorpusCount(tile.value)}
                </Link>
              ) : (
                formatCorpusCount(tile.value)
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tile.subtitle}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
