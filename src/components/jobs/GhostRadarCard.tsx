import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import type { FacetDistribution } from "@/lib/jobs/types";

/**
 * Sidebar "Ghost radar" ink-card (find-jobs page) — real `ghost_badge` facet
 * counts for the CURRENT search's result set only (spec: no invented "last
 * sweep" / "no tracked hires" copy). Renders nothing until a search has
 * actually resolved a facet distribution to read.
 */
export function GhostRadarCard({
    distribution,
    total,
}: {
    distribution: FacetDistribution | undefined;
    total: CorpusCount;
}) {
    if (!distribution) return null;
    const ghostCounts = distribution.ghost_badge ?? {};
    const flagged = (ghostCounts.caution ?? 0) + (ghostCounts.likely_ghost ?? 0);

    return (
        <div className="rounded-xl bg-ink-card-bg p-5 text-ink-card-fg dark:border dark:border-ink-card-border">
            <div className="mb-2.5 flex items-center gap-2">
                <span className="iv-pulse h-2 w-2 rounded-full bg-ink-card-accent" />
                <span className="font-display text-base font-semibold">Ghost radar</span>
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink-card-body">
                Of {formatCorpusCount(total)} matches for this search,{" "}
                <span className="font-semibold text-ink-card-fg">
                    {flagged.toLocaleString()} carry ghost-risk flags
                </span>
                . We flag postings that look stale or not actively hiring, so you don&apos;t waste an application on
                one.
            </p>
        </div>
    );
}
