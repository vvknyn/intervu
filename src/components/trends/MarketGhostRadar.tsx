"use client";

import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { GhostBadge } from "@/lib/jobs/types";
import { DEFAULT_URL_STATE, serializeJobsUrl } from "@/lib/jobs/url-state";
import { BarRow, TrendSection, type BarRowTone } from "./TrendSection";

/**
 * Corpus-wide rollup of the SAME posting check every job's own receipt
 * shows — deliberately a local tone map, not the global `ghostBadgeTone`
 * (lib/ui/status-tokens.ts): that chokepoint still marks `likely_ghost` as
 * "closed" (red) for the per-job receipt and card contexts, an intentional
 * severity read this proposal doesn't touch. On THIS surface red leaves the
 * palette (data-surfaces proposal §02 annotation 2) — "possibly stale" reads
 * as caution (amber), same as "worth verifying", because both are prompts to
 * verify, not a verdict.
 */
const BADGE_TONE: Partial<Record<GhostBadge, BarRowTone>> = {
  clear: "good",
  caution: "warn",
  likely_ghost: "warn",
};

export function MarketGhostRadar({
  ghostRadar,
}: {
  ghostRadar: { badge: GhostBadge; count: CorpusCount }[];
}) {
  if (ghostRadar.length === 0) return null;
  const total = ghostRadar.reduce((sum, row) => sum + row.count.value, 0);

  return (
    <TrendSection
      testId="trends-ghost-radar"
      label="Posting checks, across every live role"
      asOf="same check each job's receipt shows"
      intro="Every role gets the same posting check you see on its page. Across the whole corpus today:"
    >
      {ghostRadar.map(({ badge, count }) => {
        const tone = BADGE_TONE[badge];
        const pct = total > 0 ? Math.round((count.value / total) * 100) : 0;
        const href =
          badge === "unscored"
            ? undefined
            : `/${serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { ghost_badge: [badge] } })}`;
        return (
          <BarRow
            key={badge}
            testId={`trends-ghost-${badge}`}
            label={facetValueLabel("ghost_badge", badge)}
            tone={tone ?? (badge === "unscored" ? "neutral" : undefined)}
            pct={pct}
            count={formatCorpusCount(count)}
            href={href}
          />
        );
      })}
    </TrendSection>
  );
}
