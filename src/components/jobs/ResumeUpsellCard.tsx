"use client";

import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

/**
 * Dismissible, single-row upsell shown after the FIRST job row (see the list
 * render in src/app/page.tsx) when the visitor hasn't dismissed it and
 * has no usable résumé on hand yet. `onUpload` reuses the existing
 * `handleUploadClick` path — same auth-gate/import flow as the toolbar's fit
 * CTA — so a successful import hides this card reactively via `resume`
 * state, no extra wiring needed here.
 *
 * `count` is the honest, resolver-derived corpus size (lib/jobs/corpus-
 * count.ts) — never a raw, possibly Meilisearch-capped `total` — and is
 * `null` for any deep link that already carries a query/filter on first
 * load (page.tsx only captures it from the all-defaults search); the copy
 * below reads naturally either way, no dangling number or double space.
 *
 * Whole-branch review fix — the copy used to promise "rank all N roles by
 * fit," which `applyFit` (jobs/page.tsx) doesn't do: it narrows the search
 * to a résumé-derived query + a seniority facet and lets ordinary relevance
 * ranking sort the matches, exactly like typing a search would — it does
 * not produce a complete ranking of the whole corpus. "Match against" below
 * describes what actually happens (a search evaluated across the live
 * corpus) without claiming completeness it can't back up.
 */
export function ResumeUpsellCard({
    count,
    onUpload,
    onDismiss,
}: {
    count: CorpusCount | null;
    onUpload: () => void;
    onDismiss: () => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-border py-2 font-mono text-xs text-muted-foreground">
            <span>
                {count
                    ? `Match against ${formatCorpusCount(count)} live roles by fit — `
                    : "Match roles by fit — "}
                <button
                    type="button"
                    onClick={onUpload}
                    className="text-foreground underline underline-offset-4 hover:text-foreground"
                >
                    upload résumé →
                </button>
            </span>
            <button
                type="button"
                aria-label="dismiss"
                onClick={onDismiss}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
                ✕
            </button>
        </div>
    );
}
