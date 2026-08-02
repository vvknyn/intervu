"use client";

import { useEffect, useState } from "react";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";
import { getProofBandStatsAction } from "./proof-band-actions";
import type { ProofBandStats } from "./proof-band";

/**
 * Live-number proof band for the marketing landing sections. Fetches once on
 * mount (same cancelled-flag idiom `page.tsx` uses for `marketingStats` /
 * `lastUpdated`) rather than blocking first paint on a server round trip.
 * While loading, or if the fetch fails / Meili returns nothing, this renders
 * ONLY qualitative copy — never a placeholder "0" masquerading as a real
 * count.
 */
export function ProofBand() {
  const [stats, setStats] = useState<ProofBandStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProofBandStatsAction()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = stats && [
    { label: "Live jobs tracked", value: formatCorpusCount(stats.liveJobs), testId: "proof-live" },
    { label: "Screened for ghost-job risk", value: `${stats.screenedSharePct}%`, testId: "proof-screened" },
    { label: "Flagged likely-ghost", value: formatCorpusCount(stats.flaggedCount), testId: "proof-flagged" },
  ];

  return (
    <section aria-label="Corpus proof" data-testid="marketing-proof-band" className="border-t border-border py-12">
      <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
        {tiles ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {tiles.map((tile) => (
              <div key={tile.testId} data-testid={tile.testId}>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {tile.label}
                </span>
                <p className="verified-underline mt-1.5 font-mono text-[32px] font-medium leading-none text-foreground">
                  {tile.value}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="max-w-md text-sm text-muted-foreground">
            Every listing is {CORPUS_SOURCE_DESCRIPTOR}.
          </p>
        )}
      </div>
    </section>
  );
}
