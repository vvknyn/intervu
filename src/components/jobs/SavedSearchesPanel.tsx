"use client";

import { useEffect, useState } from "react";
import { BookmarkSimple, Info, X } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { settleAction } from "@/lib/load-result";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { countNewSinceAction } from "@/actions/jobs";
import { saveSavedSearchAction, deleteSavedSearchAction } from "@/actions/saved-searches";
import { invalidateSavedSearchesCache } from "@/lib/jobs/use-saved-searches";
import { stashPendingSavedSearch, type PendingSavedSearch } from "@/lib/jobs/pending-saved-search";
import { captureEvent } from "@/lib/analytics/events";
import { noteSetupFacts } from "@/hooks/use-onboarding";
import { getSignedInUser } from "@/lib/firebase/client-auth";
import { SignupGate } from "@/components/auth/SignupGate";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { decideSaveAttempt } from "@/lib/auth/guest-save-gate";
import { readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import {
    deleteSavedSearch,
    effectiveSavedSearchState,
    hrefFromJobsUrlState,
    persistSavedSearch,
    savedSearchDisplay,
    savedSearchId,
    savedSearchOrigin,
    suggestSavedSearchName,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import type { JobsUrlState } from "@/lib/jobs/url-state";

/**
 * The one auth-branching call site for saved-search mutations (mirrors
 * `FollowButton.tsx`'s `handleClick`, which branches `getSignedInUser()`
 * inline rather than forking call sites elsewhere): signed-in writes go
 * through the server actions + cache invalidation; signed-out writes stay
 * on the pre-existing localStorage broker in `lib/jobs/saved-searches.ts`.
 * Reads (list, guest merge) live in the sibling `use-saved-searches.ts`.
 */
export function SavedSearchesPanel({
    saved: savedProp,
    urlState,
    canSave,
    onApply,
    resumeQuery,
    derivedQuery = null,
    onBeforeGuestSave,
    compact = false,
    className,
    label = "Save search",
    hideList = false,
}: {
    saved: SavedSearch[];
    urlState: JobsUrlState;
    /** Parent decides when the current URL state is worth persisting. */
    canSave: boolean;
    /** Applies a saved search's effective state (`effectiveSavedSearchState`). */
    onApply: (state: JobsUrlState) => void;
    /** The query the CURRENT résumé's fit derives, or null with no résumé on the device. A résumé-origin saved search follows it. */
    resumeQuery: string | null;
    /** The fit-derived query this page's search carries, null while the search is the visitor's own: a save records its origin from it. */
    derivedQuery?: string | null;
    /**
     * Called BEFORE a guest (signed-out) save is committed. Return `"block"`
     * to cancel the save (the panel then shows the signup gate);
     * return `"proceed"` to let the save go through. Omit for signed-in-only
     * contexts where guest saves cannot occur.
     */
    onBeforeGuestSave?: () => "proceed" | "block";
    /** Inline/text-scale variant — matches the 11px indicator row rather than the h-11 toolbar. */
    compact?: boolean;
    className?: string;
    /** Trigger copy — the toolbar mount keeps "Save search"; a second mount
     *  elsewhere on the page (e.g. the results-count line) can hand a
     *  fuller sentence without forking the save mechanism itself. */
    label?: string;
    /** Suppresses the already-saved chips list, for a second compact mount
     *  (results-count line) that should offer only the save action rather
     *  than duplicate the toolbar's saved-searches management list. */
    hideList?: boolean;
}) {
    const [naming, setNaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [newCounts, setNewCounts] = useState<Record<string, CorpusCount>>({});
    const [saving, setSaving] = useState(false);
    // Optimistic remove: a chip leaves at once and returns, with a toast, if the server refuses.
    const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
    const saved = savedProp.filter((s) => !removedIds.has(s.id));
    // The count effect keys on CONTENT: `saved` is a new array every render, and the effect's own
    // setState re-renders, so keying on it refetched every count in a loop.
    const countsKey = JSON.stringify(saved.map((s) => [s.id, s.href, s.origin ?? null, resumeQuery]));
    // A guest sees the signup gate instead of a name
    // field; the search they meant to save is saved once they sign in.
    const [gated, setGated] = useState<PendingSavedSearch | null>(null);

    const startSave = () => {
        if (decideSaveAttempt(!!getSignedInUser()) === "gate") {
            setGated({ name: suggestSavedSearchName(urlState), href: hrefFromJobsUrlState(urlState), origin: savedSearchOrigin(urlState, derivedQuery) });
            return;
        }
        setNameDraft(suggestSavedSearchName(urlState));
        setNaming(true);
    };

    const commitSave = async () => {
        const name = nameDraft.trim();
        if (!name || saving) return;
        setSaving(true);
        try {
            const href = hrefFromJobsUrlState(urlState);
            const origin = savedSearchOrigin(urlState, derivedQuery);
            if (getSignedInUser()) {
                const res = await settleAction(saveSavedSearchAction({ name, href, origin }));
                if (!res.error) {
                    invalidateSavedSearchesCache();
                    captureEvent("saved_search_created", { surface: "toolbar", signed_in: true });
                    // A saved search is what setup's weekly-email step asks for.
                    noteSetupFacts({ savedSearches: 1 });
                }
            } else {
                if (onBeforeGuestSave?.() === "block") {
                    setNaming(false);
                    setNameDraft("");
                    setGated({ name, href, origin });
                    return;
                }
                persistSavedSearch({ name, href, origin });
                captureEvent("saved_search_created", { surface: "toolbar", signed_in: false });
            }
            setNaming(false);
            setNameDraft("");
        } finally {
            setSaving(false);
        }
    };

    const markRemoved = (id: string, removed: boolean) =>
        setRemovedIds((prev) => {
            const next = new Set(prev);
            if (removed) next.add(id);
            else next.delete(id);
            return next;
        });

    const removeSaved = async (s: SavedSearch) => {
        markRemoved(s.id, true);
        if (!getSignedInUser()) {
            deleteSavedSearch(s.id);
            return;
        }
        const res = await settleAction(deleteSavedSearchAction(s.id));
        if (res.error) {
            markRemoved(s.id, false);
            toast.error(`Couldn't remove "${s.name}". Try again.`);
            return;
        }
        invalidateSavedSearchesCache();
    };

    // "N new" chips — one count per rendered saved search, fetched together
    // since the list is small (capped at MAX_SAVED_SEARCHES). The cursor
    // scope is derived from the search's own href hash every time, NEVER
    // from `s.id`: a guest row's id is a random client-generated string,
    // but its server row (after sign-in merge) is keyed by the content hash
    // — deriving from the hash is what lets "new since I looked" progress
    // survive the guest→signed-in transition.
    useEffect(() => {
        const rows: [string, string, SavedSearch["origin"] | null, string | null][] = JSON.parse(countsKey);
        if (rows.length === 0) {
            setNewCounts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
            return;
        }
        let cancelled = false;
        void (async () => {
            const counts = await Promise.all(
                rows.map(([, href, origin, rq]) =>
                    countNewSinceAction(
                        { scope: "saved", params: effectiveSavedSearchState({ href, origin: origin ?? undefined }, rq) },
                        readVisitCursor(`saved:${savedSearchId(href)}`),
                    ),
                ),
            );
            if (cancelled) return;
            const next: Record<string, CorpusCount> = {};
            rows.forEach(([id], i) => {
                next[id] = counts[i];
            });
            setNewCounts(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [countsKey]);

    if (!canSave && saved.length === 0) return null;

    return (
        <div
            data-testid="saved-searches-panel"
            className={cn(
                "flex items-center gap-2 text-meta",
                compact ? "min-w-0 flex-wrap" : "flex-wrap",
                className,
            )}
        >
            {canSave && !naming && (
                <Popover open={gated !== null} onOpenChange={(open) => !open && setGated(null)}>
                    <PopoverAnchor asChild>
                        {/* Compact: below lg a bare word like the toolbar's
                            other actions (Rank with my résumé, Sort), so a
                            wrapped line's words share one left edge. */}
                        <button
                            type="button"
                            data-testid="save-search-trigger"
                            onClick={startSave}
                            className={cn(
                                compact
                                    ? cn(
                                          toolbarControlHeight,
                                          "ctl-button inline-flex box-border shrink-0 items-center justify-center whitespace-nowrap text-foreground transition-colors px-0 lg:px-2",
                                      )
                                    : "inline-flex ctl-md ctl-button items-center gap-1.5 px-3 text-foreground hover:text-foreground transition-colors",
                            )}
                        >
                            {!compact && <BookmarkSimple aria-hidden />}
                            {label}
                        </button>
                    </PopoverAnchor>
                    <PopoverContent align="start" className="w-80 p-0">
                        <SignupGate
                            reason="alert"
                            originSurface="jobs_banner"
                            returnTo={`/jobs${hrefFromJobsUrlState(urlState)}`}
                            onEngage={() => gated && stashPendingSavedSearch(window.sessionStorage, gated)}
                            className="border-0"
                        />
                    </PopoverContent>
                </Popover>
            )}
            {naming && (
                <div className={cn(
                    compact
                        ? "flex items-center gap-1"
                        : "flex ctl-lg items-center gap-1.5 rounded-ctl bg-surface border border-border px-2",
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
                                ? "ctl-sm min-w-[6rem] rounded-ctl border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:border-brand"
                                : "ctl-md min-w-[8rem] rounded-ctl border border-border bg-background px-2 text-base md:text-xs text-foreground outline-none focus:border-brand",
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
                                // control-type-allow: compact form is an inline underlined text action beside the 24px name field, sized with it
                                ? "inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50"
                                : "inline-flex ctl-md ctl-button items-center gap-1 bg-muted text-brand px-2.5 whitespace-nowrap disabled:opacity-50",
                        )}
                    >
                        {saving && <InlineSpinner className="shrink-0" />}
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
            {!hideList && saved.length > 0 && (
                <TooltipProvider delayDuration={300}>
                <ul className={cn("flex items-center gap-1.5", compact ? "min-w-0 flex-wrap" : "flex-wrap")}>
                    {saved.map((s) => {
                        const { label, terms } = savedSearchDisplay(s, resumeQuery);
                        const count = newCounts[s.id];
                        const chip = (
                            <button
                                type="button"
                                data-testid="saved-search-item"
                                onClick={() => {
                                    writeVisitCursor(`saved:${savedSearchId(s.href)}`, new Date().toISOString());
                                    onApply(effectiveSavedSearchState(s, resumeQuery));
                                }}
                                className={cn(
                                    compact
                                        ? "max-w-[8rem] truncate text-xs text-foreground underline underline-offset-2 hover:no-underline"
                                        : "max-w-[10rem] truncate text-xs text-foreground hover:underline",
                                )}
                            >
                                {label}
                            </button>
                        );
                        return (
                        <li key={s.id} className={cn(
                            compact
                                ? "inline-flex items-center gap-1"
                                : "inline-flex ctl-lg items-center gap-1 rounded-pill bg-muted px-2.5",
                        )}>
                            {terms ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>{chip}</TooltipTrigger>
                                    <TooltipContent>{terms.join(", ")}</TooltipContent>
                                </Tooltip>
                            ) : (
                                chip
                            )}
                            {terms && (
                                // Touch has no hover: a tap on this opens the same terms (hidden where a pointer can hover).
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            data-testid="saved-search-terms-trigger"
                                            aria-label={`Show the search terms in ${label}`}
                                            className="hidden size-8 items-center justify-center text-muted-foreground hover:text-foreground pointer-coarse:inline-flex"
                                        >
                                            <Info />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent data-testid="saved-search-terms" className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-3 text-sm">
                                        <ul className="list-disc space-y-0.5 pl-4">
                                            {terms.map((term) => (
                                                <li key={term}>{term}</li>
                                            ))}
                                        </ul>
                                    </PopoverContent>
                                </Popover>
                            )}
                            {(count?.value ?? 0) >= 1 && (
                                <span
                                    data-testid="saved-search-new-count"
                                    role="note"
                                    aria-label={`${formatCorpusCount(count)} new listings since your last visit`}
                                    className="text-xs font-semibold text-brand"
                                >
                                    {formatCorpusCount(count)} new
                                </span>
                            )}
                            <button
                                type="button"
                                data-testid="saved-search-remove"
                                onClick={() => void removeSaved(s)}
                                className="text-muted-foreground hover:text-foreground ml-0.5"
                                aria-label={`Remove saved search ${label}`}
                            >
                                <X />
                            </button>
                        </li>
                        );
                    })}
                </ul>
                </TooltipProvider>
            )}
        </div>
    );
}
