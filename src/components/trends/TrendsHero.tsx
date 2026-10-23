"use client";

import { TrendLink } from "./TrendLink";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
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
  const tiles: {
    label: string;
    subtitle: string;
    value: CorpusCount;
    testId: string;
    indicator: string;
    href?: string;
  }[] = [
    {
      label: "Live active openings",
      subtitle: "Verified direct from employer career pages",
      value: liveJobs,
      testId: "trends-stat-live",
      indicator: "bg-st-offer",
      href: `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined })}`,
    },
    {
      label: "Total postings tracked",
      subtitle: "Every posting we've ever seen, live or closed",
      value: totalTracked,
      testId: "trends-stat-total",
      indicator: "bg-placeholder-text dark:bg-muted-foreground",
    },
    {
      label: "Possibly stale",
      subtitle: "Failed the same posting check shown on the job page",
      value: ghostFlaggedLive,
      testId: "trends-stat-ghost",
      indicator: "bg-warn",
    },
  ];

  return (
    <div data-testid="trends-hero" className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-3">
      {tiles.map((tile) => {
        const content = (
          <div
            data-testid={tile.testId}
            className={cn(
              "flex h-full flex-col justify-between rounded-panel border border-border bg-card p-6 transition-colors",
              tile.href && "hover:bg-muted",
            )}
          >
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={cn("h-1.5 w-1.5 rounded-pill", tile.indicator)}
                  aria-hidden
                />
                <span className="text-xs font-semibold text-muted-foreground">
                  {tile.label}
                </span>
              </div>
              <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                {formatCorpusCount(tile.value)}
              </p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {tile.subtitle}
            </p>
          </div>
        );

        return tile.href ? (
          <TrendLink key={tile.testId} href={tile.href} className="block">
            {content}
          </TrendLink>
        ) : (
          <div key={tile.testId}>{content}</div>
        );
      })}
    </div>
  );
}
