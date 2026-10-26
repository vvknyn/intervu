"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { indexCategories } from "@/lib/jobs/index-categories";
import { jobsBrowseSearchHref } from "@/lib/jobs/prefetch-jobs-route";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

/**
 * "Browse by field" for the /jobs at-rest front door: one chip per field,
 * the same chip as the toolbar's Filters and Posted just above it and the
 * docked header's field chips (`fieldDirectorySuggestionChips`). These were
 * dot-separated text links (requirement 1e); on a phone they wrapped into a
 * ragged centred paragraph with a "·" hanging off each line and 20px-tall
 * tap targets, the one run of plain-text controls among boxed ones
 * (2026-10-02 polish pass). Left-aligned in a balanced `.wrap-row`, so the
 * chips share the search column's left edge and no chip strands on a line
 * of its own.
 *
 * Reuses `indexCategories` — the field directory's single source of truth,
 * also read by page.tsx's `fieldDirectoryMenu` dropdown and
 * `fieldDirectorySuggestionChips` — rather than a parallel list. `LandingMarketingShowcase`
 * (the chip-row version of this same directory) is deliberately left
 * unmounted rather than deleted: its own file and test suite still assert
 * against its real chip-row markup, and this component renders only at rest
 * where that chip row no longer mounts at all.
 */
export function FrontDoorFieldLinks({ onSelectQuery }: { onSelectQuery: (q: string) => void }) {
    const router = useRouter();
    const prefetchQuery = useCallback(
        (q: string) => {
            try {
                router.prefetch(jobsBrowseSearchHref(q));
            } catch {
                /* prefetch is best-effort */
            }
        },
        [router],
    );

    useEffect(() => {
        for (const cat of indexCategories.slice(0, 3)) {
            prefetchQuery(cat.q);
        }
    }, [prefetchQuery]);

    return (
        <div data-testid="front-door-field-links" className="mt-3 w-full text-left">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Browse by field</p>
            <div className="wrap-row">
                {indexCategories.map((cat) => (
                    <button
                        key={cat.q}
                        type="button"
                        data-testid="front-door-field-chip"
                        onClick={() => onSelectQuery(cat.q)}
                        onMouseEnter={() => prefetchQuery(cat.q)}
                        onFocus={() => prefetchQuery(cat.q)}
                        className={cn(
                            chipVariants({ interactive: true }),
                            toolbarControlHeight,
                            "ctl-button box-border items-center justify-center whitespace-nowrap px-3 leading-none",
                        )}
                    >
                        {cat.title}
                    </button>
                ))}
            </div>
        </div>
    );
}
