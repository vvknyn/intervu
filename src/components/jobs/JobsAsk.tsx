"use client";

import type { CorpusCount } from "@/lib/jobs/corpus-count";
import { formatCorpusCount } from "@/lib/jobs/corpus-count";
import { Button } from "@/components/ui/button";

/**
 * The first screen: ask for a role instead of listing everything.
 *
 * Deliberately offers no input of its own. The search line directly above is
 * the one place a query lives, and it is focused on arrival — a second box
 * here would be a second source of truth for the same string, and the two
 * would drift the moment one of them gained a behaviour.
 *
 * The résumé route is the other half of the ask, not a footnote: it is the
 * only path that ranks the whole corpus by fit rather than by keyword.
 */
export function JobsAsk({
    corpusCount,
    onUpload,
}: {
    /** Null until the corpus probe returns — the sentence adapts rather than guessing. */
    corpusCount: CorpusCount | null;
    onUpload: () => void;
}) {
    return (
        <div data-testid="jobs-ask" className="max-w-xl py-10">
            <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em]">
                What role are you after?
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                Type a position in the line above
                {corpusCount ? <> and we&apos;ll search {formatCorpusCount(corpusCount)} live-checked roles</> : <> to search live-checked roles</>}
                .
            </p>

            <div className="mt-6 border-t border-border pt-6">
                <p className="text-[14px] leading-relaxed text-muted-foreground">
                    Or upload your résumé and we&apos;ll rank every live role by how well it fits you.
                </p>
                <Button type="button" onClick={onUpload} className="mt-3">
                    upload résumé
                </Button>
            </div>
        </div>
    );
}
