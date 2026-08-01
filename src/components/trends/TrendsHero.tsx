import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { cn } from "@/lib/utils";

/**
 * Hero stat band for /trends. Three tiles, plain ink numbers (font-mono —
 * see layout.tsx's font-role comment: mono carries every number on this
 * app), no colored panels — matches GhostRadarCard's restrained register
 * rather than a heavier dashboard look.
 *
 * Deliberately only three tiles: a "companies tracked" stat was scoped in
 * the spec but the live `source` facet (probed 2026-07-29) turned out to be
 * ATS-platform identifiers ("workday_direct", "greenhouse_direct", …), not
 * company identity — fabricating a company count off it would misrepresent
 * the corpus, so that tile is dropped rather than faked (spec explicitly
 * wants no invented stat).
 */
export function TrendsHero({
  liveJobs,
  totalTracked,
  ghostFlaggedLive,
}: {
  liveJobs: CorpusCount;
  totalTracked: CorpusCount;
  ghostFlaggedLive: CorpusCount;
}) {
  const tiles: { label: string; value: CorpusCount; testId: string }[] = [
    { label: "Live jobs right now", value: liveJobs, testId: "trends-stat-live" },
    { label: "Postings tracked, all-time", value: totalTracked, testId: "trends-stat-total" },
    { label: "Flagged likely-ghost, live", value: ghostFlaggedLive, testId: "trends-stat-ghost" },
  ];

  return (
    <div data-testid="trends-hero" className="grid grid-cols-1 gap-6 border-t border-foreground pt-6 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.testId} data-testid={tile.testId}>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {tile.label}
          </span>
          <p
            className={cn(
              "mt-1.5 font-mono text-[32px] font-medium leading-none text-foreground",
              // Signature underline on the live-count number only — it's
              // the one figure on this page reflecting the corpus RIGHT
              // NOW (see .verified-underline's doc comment, globals.css).
              tile.testId === "trends-stat-live" && "verified-underline",
            )}
          >
            {formatCorpusCount(tile.value)}
          </p>
        </div>
      ))}
    </div>
  );
}
