"use client";

import { ArrowUp, X } from "@phosphor-icons/react";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

/**
 * Dismissible, single-row upsell shown after the FIRST job row (see the list
 * render in src/app/jobs/page.tsx) when the visitor hasn't dismissed it and
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
        <div className="mx-1 my-1.5 flex items-center gap-3 rounded-xl border border-dashed border-brand/40 bg-brand/5 px-3.5 py-2.5 text-sm">
            <button
                type="button"
                onClick={onUpload}
                className="flex flex-1 items-center gap-2 text-left font-medium text-brand hover:underline"
            >
                <ArrowUp size={14} className="shrink-0" />
                {count
                    ? `Upload your résumé to match against ${formatCorpusCount(count)} live roles by fit — free`
                    : "Upload your résumé to match roles by fit — free"}
            </button>
            <button
                type="button"
                aria-label="dismiss"
                onClick={onDismiss}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
                <X size={14} />
            </button>
        </div>
    );
}
