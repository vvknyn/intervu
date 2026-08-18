import { facetValueLabel } from "@/components/jobs/FilterPanel";
import type { GhostBadge } from "@/lib/jobs/types";
import { ghostBadgeTone, STATUS_PILL } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";

/**
 * This company's ghost-badge distribution — same magnitude-encoding idiom
 * (single-hue proportion bars) and the same shared status-tone pill
 * `MarketGhostRadar` uses for the market-wide version, plain counts instead
 * of a `CorpusCount` (a company's postings never approach the pagination cap
 * that type exists to guard against).
 */
export function CompanyGhostMixBand({
  ghostMix,
}: {
  ghostMix: { badge: GhostBadge; count: number }[];
}) {
  const total = ghostMix.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;
  const rows = ghostMix.filter((row) => row.count > 0);

  return (
    <section data-testid="company-ghost-mix" className="mt-8 border-t border-foreground pt-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Posting checks
      </span>
      <p className="mt-1 text-sm text-muted-foreground">How this company&apos;s live postings scored on our posting check.</p>

      <ol className="mt-4 space-y-2">
        {rows.map(({ badge, count }) => {
          const tone = ghostBadgeTone(badge);
          const pct = Math.round((count / total) * 100);
          const label = facetValueLabel("ghost_badge", badge);
          return (
            <li key={badge} data-testid={`company-ghost-${badge}`} className="flex items-center gap-3 text-[13.5px]">
              <span
                className={cn(
                  "w-32 shrink-0 sm:w-40",
                  tone
                    ? cn(
                        "inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-medium",
                        STATUS_PILL[tone],
                      )
                    : "text-[12.5px] text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="h-1.5 flex-1 bg-foreground/10">
                <span className="block h-full bg-foreground/40" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] text-muted-foreground">{pct}%</span>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] text-foreground">{count}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
