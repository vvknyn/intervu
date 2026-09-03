"use client";

import type { ReactNode } from "react";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketStats } from "@/lib/jobs/market-stats";
import { ContextHelp } from "@/components/ui/context-help";
import { POSTING_AGE_CONTEXT_COPY } from "@/lib/jobs/ghost-context-copy";
import { TrendSection } from "./TrendSection";

const MAX_VISIBLE_SOURCES = 8;

function shortDayLabel(dateLabel: string): string {
  const [, month, day] = dateLabel.split("-");
  return `${month}/${day}`;
}

export function MarketPulse({
  postedPerDay,
  liveJobs,
  closed,
  staleActiveSharePct,
  sourceCoverage,
  snapshotSummary,
}: {
  postedPerDay: { date: string; count: CorpusCount }[];
  liveJobs: CorpusCount;
  closed: MarketStats | null;
  staleActiveSharePct: number;
  sourceCoverage: { source: string; count: number }[];
  snapshotSummary?: ReactNode;
}) {
  if (postedPerDay.length === 0) return null;
  const maxValue = Math.max(...postedPerDay.map((d) => d.count.value), 1);

  return (
    <TrendSection
      testId="trends-pulse"
      label="New roles, by day first seen"
      intro={
        <>
          {formatCorpusCount(liveJobs)} active
          {closed
            ? ` · ${closed.closed.toLocaleString()} closed in ${closed.windowDays}d (${closed.companiesTracked.toLocaleString()} employers)`
            : ""}
          . {staleActiveSharePct}% older than 60d.
          <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="ml-1 inline-block align-middle" />
          {/* D1 (data-surfaces redesign, resolved): the daily bars below show
              collection cadence, not market flow — a scraper-run artifact,
              not something employers did. Say so, rather than smoothing it
              away. */}
          <span className="mt-1 block text-xs text-muted-foreground/80">
            Collection runs vary by day — swings here are ours, not the market&apos;s.
          </span>
        </>
      }
    >
      {snapshotSummary && <div className="mb-3">{snapshotSummary}</div>}

      <ol className="space-y-1">
        {postedPerDay.map(({ date, count }) => (
          <li
            key={date}
            data-testid={`trends-pulse-day-${date}`}
            className="group flex items-center gap-3 px-2 py-1 text-xs transition-colors hover:bg-muted"
          >
            <span className="mono-data w-12 shrink-0 text-xs text-muted-foreground">
              {shortDayLabel(date)}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-none bg-muted">
              <span
                className="block h-full rounded-none bg-foreground dark:bg-foreground transition-all"
                style={{ width: `${(count.value / maxValue) * 100}%` }}
              />
            </span>
            <span className="mono-data w-16 shrink-0 text-right text-xs font-semibold text-foreground">
              {formatCorpusCount(count)}
            </span>
          </li>
        ))}
      </ol>

      {sourceCoverage.length > 0 && (
        <div className="mt-4 rounded-none border border-border bg-muted p-3">
          <p data-testid="trends-pulse-coverage" className="text-xs leading-relaxed text-muted-foreground">
            <span className="mr-1 font-semibold text-foreground">
              Where these postings come from:
            </span>
            {sourceCoverage
              .slice(0, MAX_VISIBLE_SOURCES)
              .map((row) => `${facetValueLabel("source", row.source)} (${row.count.toLocaleString()})`)
              .join(" · ")}
          </p>
        </div>
      )}
    </TrendSection>
  );
}
