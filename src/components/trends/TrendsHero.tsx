"use client";

import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { Briefcase, Database, ShieldWarning, ArrowUpRight } from "@phosphor-icons/react";
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
      subtitle: "Verified direct from employer career pages",
      value: liveJobs,
      testId: "trends-stat-live",
      icon: <Briefcase size={16} weight="duotone" className="text-foreground" />,
      indicator: "bg-emerald-500",
      href: `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined })}`,
    },
    {
      label: "Total Postings Tracked",
      subtitle: "Cumulative indexed across all historical statuses",
      value: totalTracked,
      testId: "trends-stat-total",
      icon: <Database size={16} weight="duotone" className="text-foreground" />,
      indicator: "bg-slate-400 dark:bg-slate-500",
    },
    {
      label: "Possibly Stale",
      subtitle: "Flagged by automated integrity heuristic checks",
      value: ghostFlaggedLive,
      testId: "trends-stat-ghost",
      icon: <ShieldWarning size={16} weight="duotone" className="text-rose-500" />,
      indicator: "bg-rose-500",
    },
  ];

  return (
    <div data-testid="trends-hero" className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-3">
      {tiles.map((tile) => {
        const content = (
          <div
            data-testid={tile.testId}
            className="group relative flex h-full flex-col justify-between rounded-none border border-border/80 bg-card/75 p-6 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-all duration-150 hover:bg-card/90 hover:border-border-strong"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-none", tile.indicator)} aria-hidden />
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {tile.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border/70 bg-muted/40 backdrop-blur-md">
                    {tile.icon}
                  </div>
                  {tile.href && (
                    <ArrowUpRight
                      size={14}
                      className="text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-foreground"
                    />
                  )}
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-foreground tabular-nums">
                {formatCorpusCount(tile.value)}
              </p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {tile.subtitle}
            </p>
          </div>
        );

        return tile.href ? (
          <Link key={tile.testId} href={tile.href} className="block">
            {content}
          </Link>
        ) : (
          <div key={tile.testId}>{content}</div>
        );
      })}
    </div>
  );
}
