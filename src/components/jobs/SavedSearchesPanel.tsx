"use client";

import { useEffect, useState } from "react";
import { BookmarkSimple, X, CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
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
    onBeforeGuestSave,
    compact = false,
    className,
}: {
    saved: SavedSearch[];
    urlState: JobsUrlState;
    /** Parent decides when the current URL state is worth persisting. */
    canSave: boolean;
    onApply: (href: string) => void;
    /**
     * Called BEFORE a guest (signed-out) save is committed. Return `"block"`
     * to cancel the save (e.g. because the parent has opened an auth gate);
     * return `"proceed"` to let the save go through. Omit for signed-in-only
     * contexts where guest saves cannot occur.
     */
    onBeforeGuestSave?: () => "proceed" | "block";
    /** Inline/text-scale variant — matches the 11px indicator row rather than the h-11 toolbar. */
    compact?: boolean;
    className?: string;
}) {
    const [naming, setNaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [newCounts, setNewCounts] = useState<Record<string, number>>({});
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const startSave = () => {
        setNameDraft(suggestSavedSearchName(urlState));
        setNaming(true);
    };

    const commitSave = async () => {
        const name = nameDraft.trim();
        if (!name || saving) return;
        setSaving(true);
        try {
            const href = hrefFromJobsUrlState(urlState);
            if (getCurrentUser()) {
                const res = await saveSavedSearchAction({ name, href });
                if (!res.error) invalidateSavedSearchesCache();
            } else {
                if (onBeforeGuestSave?.() === "block") {
                    setNaming(false);
                    setNameDraft("");
                    return;
                }
                persistSavedSearch({ name, href });
            }
            setNaming(false);
            setNameDraft("");
        } finally {
            setSaving(false);
        }
    };

    const removeSaved = async (s: SavedSearch) => {
        if (removingId) return;
        setRemovingId(s.id);
        try {
            if (getCurrentUser()) {
                const res = await deleteSavedSearchAction(s.id);
                if (!res.error) invalidateSavedSearchesCache();
            } else {
                deleteSavedSearch(s.id);
            }
        } finally {
            setRemovingId(null);
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
        <div
            data-testid="saved-searches-panel"
            className={cn(
                "flex items-center gap-2 text-meta",
                compact ? "shrink-0 flex-nowrap" : "flex-wrap",
                className,
            )}
        >
            {canSave && !naming && (
                <button
                    type="button"
                    data-testid="save-search-trigger"
                    onClick={startSave}
                    className={cn(
                        compact
                            ? cn(toolbarControlHeight, "inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 text-xs leading-none text-muted-foreground transition-colors hover:text-foreground")
                            : "inline-flex h-11 sm:h-[46px] items-center gap-1.5 rounded-none glass-tint-muted px-3 text-xs font-semibold text-foreground hover:text-foreground transition-colors",
                    )}
                >
                    <BookmarkSimple size={compact ? 12 : 14} aria-hidden />
                    Save search
                </button>
            )}
            {naming && (
                <div className={cn(
                    compact
                        ? "flex items-center gap-1"
                        : "flex h-11 sm:h-[46px] items-center gap-1.5 rounded-none glass-panel px-2",
                )}>
                    <input
                        data-testid="save-search-name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void commitSave();
                            if (e.key === "Escape") setNaming(false);
                        }}
                        className={cn(
                            compact
                                ? "h-6 min-w-[6rem] rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:border-brand"
                                : "h-7 min-w-[8rem] rounded-none border border-border bg-background px-2 text-base md:text-xs text-foreground outline-none focus:border-brand",
                        )}
                        aria-label="Saved search name"
                        autoFocus
                    />
                    <button
                        type="button"
                        data-testid="save-search-commit"
                        disabled={saving}
                        onClick={() => void commitSave()}
                        className={cn(
                            compact
                                ? "inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50"
                                : "inline-flex h-7 items-center gap-1 rounded-none glass-tint-blue px-2.5 text-xs font-semibold whitespace-nowrap disabled:opacity-50",
                        )}
                    >
                        {saving && <CircleNotch size={12} className="animate-spin shrink-0" aria-hidden />}
                        {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                        type="button"
                        onClick={() => setNaming(false)}
                        className={cn(
                            compact
                                ? "text-xs text-muted-foreground hover:text-foreground"
                                : "text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 px-1",
                        )}
                    >
                        ✕
                    </button>
                </div>
            )}
            {saved.length > 0 && (
                <ul className={cn("flex items-center gap-1.5", compact ? "shrink-0 flex-nowrap" : "flex-wrap")}>
                    {saved.map((s) => (
                        <li key={s.id} className={cn(
                            compact
                                ? "inline-flex items-center gap-1"
                                : "inline-flex h-11 sm:h-[46px] items-center gap-1 rounded-none glass-tint-muted px-2.5 py-0.5",
                        )}>
                            <button
                                type="button"
                                data-testid="saved-search-item"
                                onClick={() => {
                                    writeVisitCursor(`saved:${savedSearchId(s.href)}`, new Date().toISOString());
                                    onApply(s.href);
                                }}
                                className={cn(
                                    compact
                                        ? "max-w-[8rem] truncate text-xs text-foreground underline underline-offset-2 hover:no-underline"
                                        : "max-w-[10rem] truncate text-xs text-foreground hover:underline",
                                )}
                                title={s.name}
                            >
                                {s.name}
                            </button>
                            {(newCounts[s.id] ?? 0) >= 1 && (
                                <span
                                    data-testid="saved-search-new-count"
                                    className="text-xs font-semibold text-brand"
                                >
                                    +{newCounts[s.id]}
                                </span>
                            )}
                            <button
                                type="button"
                                data-testid="saved-search-remove"
                                disabled={removingId === s.id}
                                onClick={() => void removeSaved(s)}
                                className="text-muted-foreground hover:text-foreground ml-0.5 disabled:opacity-50"
                                aria-label={`Remove saved search ${s.name}`}
                            >
                                {removingId === s.id ? (
                                    <CircleNotch size={11} className="animate-spin" aria-hidden />
                                ) : (
                                    <X size={11} />
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
