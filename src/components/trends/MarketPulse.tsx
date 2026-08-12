import type { ReactNode } from "react";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketStats } from "@/lib/jobs/market-stats";
import { ContextHelp } from "@/components/ui/context-help";
import { POSTING_AGE_CONTEXT_COPY } from "@/lib/jobs/ghost-context-copy";

/** Display cap for the source/ATS coverage line — same "top N, rest omitted"
 *  posture as TopCountriesList's `MAX_VISIBLE_COUNTRIES`, sized down since
 *  this renders as one quiet line rather than a ranked list. */
const MAX_VISIBLE_SOURCES = 8;

/** "YYYY-MM-DD" -> "MM/DD", this component's only consumer of the raw date
 *  label (day-buckets.ts's `dateLabel`) — short enough for 14 bar rows. */
function shortDayLabel(dateLabel: string): string {
  const [, month, day] = dateLabel.split("-");
  return `${month}/${day}`;
}

/**
 * /trends "Market pulse" section — flow stats openjobdata.com/statistics
 * shows and our stock-only page didn't: a 14-day posted series, the
 * active/closed split, how stale the live corpus is, and ATS-source
 * coverage. `snapshotSummary` is an optional slot for the daily-snapshot
 * delta/tracking-since lines (lib/trends/daily-snapshot.ts) — passed in as
 * already-rendered JSX so this component has no dependency on that module
 * (kept as two independently shippable pieces; see page.tsx for how they
 * compose).
 *
 * Day-bar rows reuse PostingFreshnessBand's exact visual idiom (mono label,
 * quiet proportion bar, right-aligned mono count) rather than a chart
 * library — this page has no chart dependency and this section shouldn't be
 * the first to add one.
 */
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
    <section data-testid="trends-pulse" className="mt-10 border-t border-foreground pt-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Market pulse
      </span>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatCorpusCount(liveJobs)} active
        {/* Omitted, not zeroed, when unknown — this line used to read "0
            closed to date" because the query behind it could only ever
            return 0. Saying nothing is the honest degradation. The window
            comes off the data so this copy can't outlive a change to it. */}
        {closed
          ? ` · ${closed.closed.toLocaleString()} closed in the last ${closed.windowDays} days across ${closed.companiesTracked.toLocaleString()} employers`
          : ""}
        . Of live roles, {staleActiveSharePct}% have been open 60+ days.
        {/* R7 (founder, 2026-08-09): this is an age-only aggregate stat with
            no other signal to weigh against it — the balance note mounts
            unconditionally here, unlike JobDetail's per-job grid. */}
        <ContextHelp content={POSTING_AGE_CONTEXT_COPY} className="self-center" />
      </p>

      {snapshotSummary}

      <ol className="mt-4 space-y-2">
        {postedPerDay.map(({ date, count }) => (
          <li key={date} data-testid={`trends-pulse-day-${date}`} className="flex items-center gap-3 text-[13.5px]">
            <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{shortDayLabel(date)}</span>
            <span className="h-3 flex-1 bg-foreground/10">
              <span className="block h-full bg-foreground/40" style={{ width: `${(count.value / maxValue) * 100}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-[12.5px] text-foreground">
              {formatCorpusCount(count)}
            </span>
          </li>
        ))}
      </ol>

      {sourceCoverage.length > 0 && (
        <p data-testid="trends-pulse-coverage" className="mt-4 font-mono text-[11px] text-muted-foreground">
          coverage:{" "}
          {sourceCoverage
            .slice(0, MAX_VISIBLE_SOURCES)
            .map((row) => `${facetValueLabel("source", row.source)} (${row.count.toLocaleString()})`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
