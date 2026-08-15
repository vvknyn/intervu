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
    <section data-testid="trends-ghost-radar" className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-chip text-muted-foreground">
          <ShieldWarning size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Ghost Radar (Market-Wide)</h2>
          <p className="text-xs text-muted-foreground">Automated ghost-risk signal across every active posting in the index</p>
        </div>
      </div>

      <ol className="mt-5 space-y-3">
        {ghostRadar.map(({ badge, count }) => {
          const tone = ghostBadgeTone(badge);
          const pct = total > 0 ? Math.round((count.value / total) * 100) : 0;
          const label = facetValueLabel("ghost_badge", badge);
          return (
            <li key={badge} data-testid={`trends-ghost-${badge}`} className="flex items-center gap-3 text-[13.5px]">
              <span
                className={cn(
                  "w-32 shrink-0 sm:w-40 font-medium",
                  tone
                    ? cn("inline-flex items-center justify-center rounded-md px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase", STATUS_PILL[tone])
                    : "text-[12.5px] text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-chip">
                <span
                  className={cn("block h-full rounded-full transition-all", tone ? STATUS_FILL[tone] : "bg-st-saved")}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-[12px] font-semibold text-muted-foreground">{pct}%</span>
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
