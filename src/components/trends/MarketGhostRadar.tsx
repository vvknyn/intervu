"use client";

import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { GhostBadge } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { STATUS_FILL, STATUS_PILL, ghostBadgeTone } from "@/lib/ui/status-tokens";
import { ShieldWarning } from "@phosphor-icons/react";

export function MarketGhostRadar({
  ghostRadar,
}: {
  ghostRadar: { badge: GhostBadge; count: CorpusCount }[];
}) {
  if (ghostRadar.length === 0) return null;
  const total = ghostRadar.reduce((sum, row) => sum + row.count.value, 0);

  return (
    <section data-testid="trends-ghost-radar" className="rounded-none border border-border bg-card p-6 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground/70">
            <ShieldWarning size={15} weight="duotone" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">Market Integrity & Ghost Radar</h2>
            <p className="text-xs text-muted-foreground">Automated risk signals evaluated across all active postings</p>
          </div>
        </div>
        <span className="hidden text-[10.5px] uppercase tracking-wider text-muted-foreground sm:inline-block">
          Integrity Scan
        </span>
      </div>

      <ol className="mt-4 space-y-2">
        {ghostRadar.map(({ badge, count }) => {
          const tone = ghostBadgeTone(badge);
          const pct = total > 0 ? Math.round((count.value / total) * 100) : 0;
          const label = facetValueLabel("ghost_badge", badge);
          return (
            <li
              key={badge}
              data-testid={`trends-ghost-${badge}`}
              className="group flex items-center gap-3 px-2 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              <div className="w-28 shrink-0 sm:w-32">
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-none px-2 py-0.5 text-[10.5px] font-bold uppercase",
                    tone
                      ? STATUS_PILL[tone]
                      : "border border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="h-1.5 flex-1 overflow-hidden rounded-none bg-muted/80">
                  <span
                    className={cn("block h-full rounded-none transition-all", tone ? STATUS_FILL[tone] : "bg-slate-400 dark:bg-slate-600")}
                    style={{ width: `${pct}%` }}
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
