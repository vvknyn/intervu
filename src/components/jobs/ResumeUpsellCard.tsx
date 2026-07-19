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
 * count.ts) — never a raw, possibly Meilisearch-capped `total` — so a
 * capped Meilisearch total can no longer print here as if it were exact.
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
                Upload your résumé to rank all {count ? formatCorpusCount(count) : ""} roles by fit — free
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
