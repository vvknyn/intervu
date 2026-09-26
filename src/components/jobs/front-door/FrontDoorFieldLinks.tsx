"use client";

import { indexCategories } from "@/lib/jobs/index-categories";
import { DotSeparated } from "@/components/ui/dot-separated";

/**
 * "Browse by field" as plain text links, for the /jobs at-rest front door
 * (requirement 1e — the mock's quiet, centered hero, not a row of boxed
 * chips competing with the search field for attention).
 *
 * Reuses `indexCategories` — the field directory's single source of truth,
 * also read by page.tsx's `fieldDirectoryMenu` dropdown and
 * `fieldDirectorySuggestionChips` — rather than a parallel list, and reuses
 * `DotSeparated` rather than a bespoke divider. `LandingMarketingShowcase`
 * (the chip-row version of this same directory) is deliberately left
 * unmounted rather than deleted: its own file and test suite still assert
 * against its real chip-row markup, and this component renders only at rest
 * where that chip row no longer mounts at all.
 */
export function FrontDoorFieldLinks({ onSelectQuery }: { onSelectQuery: (q: string) => void }) {
    return (
        <div className="mx-auto mt-2 max-w-[960px] text-center">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Browse by field</p>
            <p className="text-sm">
                <DotSeparated
                    items={indexCategories.map((cat) => (
                        <button
                            key={cat.q}
                            type="button"
                            onClick={() => onSelectQuery(cat.q)}
                            className="text-foreground underline-offset-4 hover:underline"
                        >
                            {cat.title}
                        </button>
                    ))}
                />
            </p>
        </div>
    );
}
