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
    <section data-testid="trends-pulse" className="mt-6 rounded-2xl border border-slate-200/90 bg-card p-6 shadow-xs dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <Pulse size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Market Pulse & Ingestion Velocity</h2>
          <p className="text-xs text-muted-foreground">
            {formatCorpusCount(liveJobs)} active
            {closed
              ? ` · ${closed.closed.toLocaleString()} closed in last ${closed.windowDays}d across ${closed.companiesTracked.toLocaleString()} employers`
              : ""}
            . {staleActiveSharePct}% open 60+ days.
            <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="ml-1 inline-block align-middle" />
          </p>
        </div>
      </div>

      {snapshotSummary}

      <ol className="mt-5 space-y-2.5">
        {postedPerDay.map(({ date, count }) => (
          <li key={date} data-testid={`trends-pulse-day-${date}`} className="flex items-center gap-3 text-[13.5px]">
            <span className="w-12 shrink-0 font-mono text-[11px] font-bold text-muted-foreground">{shortDayLabel(date)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className="block h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-500" style={{ width: `${(count.value / maxValue) * 100}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-[12.5px] font-bold text-foreground">
              {formatCorpusCount(count)}
            </span>
          </li>
        ))}
      </ol>

      {sourceCoverage.length > 0 && (
        <div className="mt-5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
          <p data-testid="trends-pulse-coverage" className="font-mono text-[11px] text-muted-foreground">
            <span className="font-bold text-foreground uppercase tracking-wider mr-1">ATS Ingestion Coverage:</span>
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
