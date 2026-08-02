import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { GhostBadge } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { STATUS_PILL, ghostBadgeTone, type StatusTone } from "@/lib/ui/status-tokens";

/** Proportion-bar fill color per row tone, reusing the same solid
 *  `--color-st-*` tokens (status-tokens.ts) that already drive `STATUS_PILL`'s
 *  border/text — local to this file since MarketGhostRadar is the only /trends
 *  bar surface where the mock colors the fill per row (green/amber/rust)
 *  instead of the flat neutral fill `TopCountriesList`/`PostingFreshnessBand`
 *  use for plain magnitude bars. */
const TONE_FILL: Record<StatusTone, string> = {
  saved: "bg-st-saved",
  applied: "bg-st-applied",
  intv: "bg-st-intv",
  offer: "bg-st-offer",
  closed: "bg-st-closed",
};

/**
 * Market-wide ghost radar — `ghost_badge` distribution across every ACTIVE
 * posting (the per-search version lives in GhostRadarCard; this is the
 * corpus-wide equivalent). Reuses the shared status-tone pill
 * (`ghostBadgeTone`/`STATUS_PILL` — same component `QuestionsGrid`/
 * `DashboardContainer` already use for status color) rather than inventing
 * new colors; "unscored" gets no pill, matching that module's existing
 * "no chip for no signal" rule.
 */
export function MarketGhostRadar({
  ghostRadar,
}: {
  ghostRadar: { badge: GhostBadge; count: CorpusCount }[];
}) {
  if (ghostRadar.length === 0) return null;
  const total = ghostRadar.reduce((sum, row) => sum + row.count.value, 0);

  return (
    <section data-testid="trends-ghost-radar" className="mt-10 border-t border-foreground pt-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Ghost radar, market-wide
      </span>
      <p className="mt-1 text-sm text-muted-foreground">
        Ghost-risk signal across every live posting we track.
      </p>

      <ol className="mt-4 space-y-2">
        {ghostRadar.map(({ badge, count }) => {
          const tone = ghostBadgeTone(badge);
          const pct = total > 0 ? Math.round((count.value / total) * 100) : 0;
          const label = facetValueLabel("ghost_badge", badge);
          return (
            <li key={badge} data-testid={`trends-ghost-${badge}`} className="flex items-center gap-3 text-[13.5px]">
              <span
                className={cn(
                  "w-32 shrink-0 sm:w-40",
                  tone
                    ? cn("inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-medium", STATUS_PILL[tone])
                    : "text-[12.5px] text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="h-3 flex-1 bg-foreground/10">
                <span
                  className={cn("block h-full", tone ? TONE_FILL[tone] : "bg-foreground/40")}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] text-muted-foreground">{pct}%</span>
              <span className="w-20 shrink-0 text-right font-mono text-[12.5px] text-foreground">
                {formatCorpusCount(count)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
