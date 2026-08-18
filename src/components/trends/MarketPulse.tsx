"use client";

import type { ReactNode } from "react";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketStats } from "@/lib/jobs/market-stats";
import { ContextHelp } from "@/components/ui/context-help";
import { POSTING_AGE_CONTEXT_COPY } from "@/lib/jobs/ghost-context-copy";
import { Pulse } from "@phosphor-icons/react";

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
    <section data-testid="trends-pulse" className="rounded-none border border-border bg-card p-6 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground/70">
            <Pulse size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Ingestion Velocity & Daily Pulse</h2>
            <p className="text-xs text-muted-foreground">
              {formatCorpusCount(liveJobs)} active
              {closed
                ? ` · ${closed.closed.toLocaleString()} closed in ${closed.windowDays}d (${closed.companiesTracked.toLocaleString()} employers)`
                : ""}
              . {staleActiveSharePct}% older than 60d.
              <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="ml-1 inline-block align-middle" />
            </p>
          </div>
        </div>
        <span className="hidden text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          14-Day Velocity
        </span>
      </div>

      {snapshotSummary && <div className="mt-3">{snapshotSummary}</div>}

      <ol className="mt-4 space-y-1">
        {postedPerDay.map(({ date, count }) => (
          <li
            key={date}
            data-testid={`trends-pulse-day-${date}`}
            className="group flex items-center gap-3 px-2 py-1 text-xs transition-colors hover:bg-muted/40"
          >
            <span className="w-12 shrink-0 text-[11px] font-medium text-muted-foreground">
              {shortDayLabel(date)}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-none bg-muted/80">
              <span
                className="block h-full rounded-none bg-slate-700 dark:bg-slate-300 transition-all"
                style={{ width: `${(count.value / maxValue) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right text-xs font-bold text-foreground tabular-nums">
              {formatCorpusCount(count)}
            </span>
          </li>
        ))}
      </ol>

      {sourceCoverage.length > 0 && (
        <div className="mt-4 rounded-none border border-border bg-muted/20 p-3">
          <p data-testid="trends-pulse-coverage" className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-bold uppercase tracking-wider text-foreground mr-1">
              ATS Ingestion Feeds:
            </span>
            {sourceCoverage
              .slice(0, MAX_VISIBLE_SOURCES)
              .map((row) => `${facetValueLabel("source", row.source)} (${row.count.toLocaleString()})`)
              .join(" · ")}
          </p>
        </div>
      )}
    </section>
  );
}
