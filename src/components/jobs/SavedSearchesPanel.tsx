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
        <div data-testid="saved-searches-panel" className={cn("flex flex-wrap items-center gap-2 font-mono text-[11px]", className)}>
            {canSave && !naming && (
                <button
                    type="button"
                    data-testid="save-search-trigger"
                    onClick={startSave}
                    className="inline-flex h-11 sm:h-[46px] items-center gap-1.5 rounded-none glass-tint-muted px-3 text-xs font-mono font-bold uppercase tracking-wider text-foreground hover:text-foreground transition-colors"
                >
                    <BookmarkSimple size={14} aria-hidden />
                    Save Search
                </button>
            )}
            {naming && (
                <div className="flex h-11 sm:h-[46px] items-center gap-1.5 rounded-none glass-panel px-2">
                    <input
                        data-testid="save-search-name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void commitSave();
                            if (e.key === "Escape") setNaming(false);
                        }}
                        className="h-7 min-w-[8rem] rounded-none border border-border bg-background/80 px-2 font-mono text-[11px] text-foreground outline-none focus:border-brand"
                        aria-label="Saved search name"
                        autoFocus
                    />
                    <button
                        type="button"
                        data-testid="save-search-commit"
                        onClick={() => void commitSave()}
                        className="h-7 rounded-none glass-tint-blue px-2.5 font-mono text-[10px] font-bold uppercase"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => setNaming(false)}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 px-1"
                    >
                        ✕
                    </button>
                </div>
            )}
            {saved.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5">
                    {saved.map((s) => (
                        <li key={s.id} className="inline-flex h-11 sm:h-[46px] items-center gap-1 rounded-none glass-tint-muted px-2.5 py-0.5">
                            <button
                                type="button"
                                data-testid="saved-search-item"
                                onClick={() => {
                                    writeVisitCursor(`saved:${savedSearchId(s.href)}`, new Date().toISOString());
                                    onApply(s.href);
                                }}
                                className="max-w-[10rem] truncate font-mono text-[11px] font-medium text-foreground hover:underline"
                                title={s.name}
                            >
                                {s.name}
                            </button>
                            {(newCounts[s.id] ?? 0) >= 1 && (
                                <span
                                    data-testid="saved-search-new-count"
                                    className="font-mono text-[10px] font-bold text-brand"
                                >
                                    +{newCounts[s.id]}
                                </span>
                            )}
                            <button
                                type="button"
                                data-testid="saved-search-remove"
                                onClick={() => void removeSaved(s)}
                                className="text-muted-foreground hover:text-foreground ml-0.5"
                                aria-label={`Remove saved search ${s.name}`}
                            >
                                <X size={11} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
