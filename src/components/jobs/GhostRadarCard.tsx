import Link from "next/link";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { GHOST_RESEARCH_HREF } from "@/lib/marketing-stats";
import type { FacetDistribution } from "@/lib/jobs/types";

/**
 * Rail "Ghost radar" section (editorial pass: ruled, ink text — no dark
 * panel, no pulsing dot). Real `ghost_badge` facet counts for the CURRENT
 * search's result set only (spec: no invented "last sweep" / "no tracked
 * hires" copy). Renders nothing until a search has actually resolved a
 * facet distribution to read.
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
        <div className="border-t border-foreground pt-2.5">
            <span className="text-xs text-muted-foreground">Posting check</span>
            <p className="mt-2 text-xs leading-relaxed text-foreground">
                Of {formatCorpusCount(total)} matches for this search, {flagged.toLocaleString()} carry ghost-risk
                flags. We{" "}
                <Link href={GHOST_RESEARCH_HREF} className="underline underline-offset-2 hover:text-foreground">
                    flag postings that look stale or not actively hiring
                </Link>
                , so you don&apos;t waste an application on one.
            </p>
        </div>
    );
}
