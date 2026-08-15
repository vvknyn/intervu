"use client";

import { useEffect, useState } from "react";
import { BookmarkSimple, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { countNewSinceAction } from "@/actions/jobs";
import { saveSavedSearchAction, deleteSavedSearchAction } from "@/actions/saved-searches";
import { invalidateSavedSearchesCache } from "@/lib/jobs/use-saved-searches";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import {
    deleteSavedSearch,
    hrefFromJobsUrlState,
    jobsUrlStateFromSavedHref,
    persistSavedSearch,
    savedSearchId,
    suggestSavedSearchName,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import type { JobsUrlState } from "@/lib/jobs/url-state";

/**
 * The one auth-branching call site for saved-search mutations (mirrors
 * `FollowButton.tsx`'s `handleClick`, which branches `getCurrentUser()`
 * inline rather than forking call sites elsewhere): signed-in writes go
 * through the server actions + cache invalidation; signed-out writes stay
 * on the pre-existing localStorage broker in `lib/jobs/saved-searches.ts`.
 * Reads (list, guest merge) live in the sibling `use-saved-searches.ts`.
 */
export function SavedSearchesPanel({
    saved,
    urlState,
    canSave,
    onApply,
    className,
}: {
    saved: SavedSearch[];
    urlState: JobsUrlState;
    /** Parent decides when the current URL state is worth persisting. */
    canSave: boolean;
    onApply: (href: string) => void;
    className?: string;
}) {
    const [naming, setNaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [newCounts, setNewCounts] = useState<Record<string, number>>({});

    const startSave = () => {
        setNameDraft(suggestSavedSearchName(urlState));
        setNaming(true);
    };

    const commitSave = async () => {
        const name = nameDraft.trim();
        if (!name) return;
        const href = hrefFromJobsUrlState(urlState);
        if (getCurrentUser()) {
            const res = await saveSavedSearchAction({ name, href });
            if (!res.error) invalidateSavedSearchesCache();
        } else {
            persistSavedSearch({ name, href });
        }
        setNaming(false);
        setNameDraft("");
    };

    const removeSaved = async (s: SavedSearch) => {
        if (getCurrentUser()) {
            const res = await deleteSavedSearchAction(s.id);
            if (!res.error) invalidateSavedSearchesCache();
        } else {
            deleteSavedSearch(s.id);
        }
    };

    // "N new" chips — one count per rendered saved search, fetched together
    // since the list is small (capped at MAX_SAVED_SEARCHES). The cursor
    // scope is derived from the search's own href hash every time, NEVER
    // from `s.id`: a guest row's id is a random client-generated string,
    // but its server row (after sign-in merge) is keyed by the content hash
    // — deriving from the hash is what lets "new since I looked" progress
    // survive the guest→signed-in transition.
    useEffect(() => {
        if (saved.length === 0) {
            setNewCounts({});
            return;
        }
        let cancelled = false;
        void (async () => {
            const counts = await Promise.all(
                saved.map((s) =>
                    countNewSinceAction(
                        { scope: "saved", params: jobsUrlStateFromSavedHref(s.href) },
                        readVisitCursor(`saved:${savedSearchId(s.href)}`),
                    ),
                ),
            );
            if (cancelled) return;
            const next: Record<string, number> = {};
            saved.forEach((s, i) => {
                next[s.id] = counts[i];
            });
            setNewCounts(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [saved]);

    if (!canSave && saved.length === 0) return null;

    return (
        <div data-testid="saved-searches-panel" className={cn("mt-2 flex flex-col gap-2", className)}>
            {canSave && !naming && (
                <button
                    type="button"
                    data-testid="save-search-trigger"
                    onClick={startSave}
                    className="inline-flex w-fit items-center gap-1.5 text-[12px] text-foreground/80 underline underline-offset-[3px] hover:text-foreground"
                >
                    <BookmarkSimple size={14} aria-hidden />
                    Save this search
                </button>
            )}
            {naming && (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        data-testid="save-search-name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void commitSave();
                            if (e.key === "Escape") setNaming(false);
                        }}
                        className="h-8 min-w-[10rem] rounded-none border border-foreground/30 bg-background px-2 text-[12px] text-foreground outline-none focus:border-foreground/60"
                        aria-label="Saved search name"
                        autoFocus
                    />
                    <button
                        type="button"
                        data-testid="save-search-commit"
                        onClick={() => void commitSave()}
                        className="text-[12px] font-medium text-foreground underline underline-offset-[3px]"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => setNaming(false)}
                        className="text-[12px] text-foreground/60 underline underline-offset-[3px]"
                    >
                        Cancel
                    </button>
                </div>
            )}
            {saved.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {saved.map((s) => (
                        <li key={s.id} className="inline-flex items-center gap-1">
                            <button
                                type="button"
                                data-testid="saved-search-item"
                                onClick={() => {
                                    writeVisitCursor(`saved:${savedSearchId(s.href)}`, new Date().toISOString());
                                    onApply(s.href);
                                }}
                                className="max-w-[14rem] truncate text-[12px] text-foreground underline underline-offset-[3px] hover:opacity-80"
                                title={s.name}
                            >
                                {s.name}
                            </button>
                            {(newCounts[s.id] ?? 0) >= 1 && (
                                <span
                                    data-testid="saved-search-new-count"
                                    className="font-mono text-[10.5px] text-muted-foreground"
                                >
                                    {newCounts[s.id]} new
                                </span>
                            )}
                            <button
                                type="button"
                                data-testid="saved-search-remove"
                                onClick={() => void removeSaved(s)}
                                className="text-foreground/50 hover:text-foreground"
                                aria-label={`Remove saved search ${s.name}`}
                            >
                                <X size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
