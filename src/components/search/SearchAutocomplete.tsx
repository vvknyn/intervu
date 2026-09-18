"use client";

import { Fragment, useState, useEffect, useRef, useSyncExternalStore, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAnchoredOverlayRect } from "@/lib/use-anchored-overlay-rect";
import { Input } from "@/components/ui/input";
import { CircleNotch, Clock, MagnifyingGlass, Buildings, CaretRight, X } from "@phosphor-icons/react";
import { getSuggestions, SearchSuggestion } from "@/lib/search-suggestions";
import { highlightMatch } from "@/lib/highlight-match";
import {
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
} from "@/lib/jobs/recent-searches";
import { cn } from "@/lib/utils";

interface SearchAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSearch: () => void;
    /**
     * Optional clear affordance. When provided and `value` is non-empty, this
     * component renders its own "X" button, absolutely positioned at the
     * input's right edge INSIDE its own relative wrapper, above the input's
     * `z-20` (see the Input's `className` below). The stacking contract for
     * any control layered over the field belongs to the field itself, not to
     * a page-level sibling guessing at a z-index that has to beat the
     * Input's — that guess is exactly what left the mobile jobs-page clear
     * button unreachable (its sibling `z-10` lost to the Input's `z-20`).
     * Omitted (the default) renders no button — existing callers unaffected.
     */
    onClear?: () => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string; // Class for the Input
    containerClassName?: string;
    autoFocus?: boolean;
    leadingIcon?: React.ReactNode;
    /** Accessible name for the underlying `<input>` — it carries no visible
     *  `<label>` (the placeholder is not one), so screen readers need this
     *  instead. Defaults to the query-search case; a non-search mount would
     *  pass its own. */
    ariaLabel?: string;
    /**
     * Optional async suggestion source (e.g. title/company from a live search
     * index). When provided, it REPLACES the local `getSuggestions` + history
     * source entirely — default behavior (no prop) is unchanged, so existing/
     * future callers (prep pages) keep working without edits. Debounced
     * 150ms; a monotonic generation guard drops out-of-order responses so a
     * slow, stale request can't clobber a faster, newer one.
     */
    suggest?: (q: string) => Promise<SearchSuggestion[]>;
    /**
     * Optional trending/popular-searches seed list (e.g. `resolveSearchSeeds`)
     * shown in the dropdown, under a "Popular searches" header, whenever the
     * box is focused with an empty query — the standard trending-searches-in-
     * typeahead pattern. Only takes effect on the `suggest`-prop path (the
     * empty-query case there currently just clears the dropdown); omitted or
     * empty is a no-op, so existing callers are unaffected. Seeds are mapped
     * into the SAME `suggestions` state as live results, so selection,
     * keyboard nav, and the click handler are the one existing path — not a
     * parallel seed-specific handler.
     */
    seeds?: string[];
}

export interface SearchAutocompleteHandle {
    /** Dismiss the suggestion dropdown without touching `value`. A submit
     *  that happens OUTSIDE this component — an external "Search" button
     *  click, a category/seed pick — never runs this component's own
     *  Enter-key handler (which already closes the dropdown), so it left the
     *  dropdown floating over freshly-loaded results. One imperative method
     *  here, called from the caller's own submit chokepoint, instead of an
     *  `open`/`onOpenChange` prop pair the parent would have to thread
     *  through every keystroke. */
    close: () => void;
    /** Put the cursor in the field. Used when the search has scrolled away and
     *  something else — the docked control in the header — brings it back:
     *  scrolling the box into view without focusing it leaves the person to
     *  click a second time. */
    focus: () => void;
}

/**
 * Section header text for each suggestion type — single source of truth for
 * the dropdown's group labels (item 6a, 2026-08-21 front-door audit: the
 * dropdown mixed roles, companies, and stray junk with no labels at all,
 * generalized from the one pre-existing 'seed' -> "Popular searches"
 * special case). Keyed off `SearchSuggestion['type']` itself — TypeScript
 * requires every member of that closed union to be handled below (`undefined`
 * for a type deliberately left unlabeled), so a new suggestion type can't
 * silently render without a labeling decision having been made for it.
 * A type omitted here (falls through to `undefined`) renders no header —
 * `'full'` (compound one-off boosted rows) doesn't read as its own group.
 */
const SECTION_LABELS: Record<SearchSuggestion["type"], string | undefined> = {
    seed: "Popular searches",
    history: "Recent searches",
    role: "Roles",
    company: "Companies",
    full: undefined,
};

export const SearchAutocomplete = forwardRef<SearchAutocompleteHandle, SearchAutocompleteProps>(function SearchAutocomplete({
    value,
    onChange,
    onSearch,
    onClear,
    placeholder,
    disabled,
    className,
    containerClassName,
    autoFocus,
    leadingIcon,
    suggest,
    seeds,
    ariaLabel = "Search jobs"
}, ref) {
    const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
    const [suggestLoading, setSuggestLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    // The SHARED recent-searches store (lib/jobs/recent-searches.ts) — the
    // same store the jobs page's landing chips render, so the dropdown
    // history and the chips can never disagree. Read-only here: recording
    // happens at the caller's search-commit chokepoint (the `onSearch`
    // handler), which covers every commit path through this component —
    // typed Enter and suggestion picks both funnel out through `onSearch`.
    const history = useSyncExternalStore(
        subscribeRecentSearches,
        getRecentSearchesSnapshot,
        getRecentSearchesServerSnapshot,
    );
    // Always hold the LATEST `onSearch`/`suggest` props, updated by a single
    // no-dependency effect that runs after every render (declared first so
    // it commits before the suggestion effect below reads it in the same
    // flush). Two independent reasons this exists:
    //  - `handleSelect` changes `value` via `onChange` and then needs to call
    //    `onSearch` — but the callback the parent passes in typically closes
    //    over its own `value` state, so calling the closure captured at THIS
    //    render would search the pre-selection text.
    //  - `suggest` is typically an inline arrow at the call site, so its
    //    IDENTITY churns on every parent render even when nothing relevant
    //    changed (loading, unrelated state). The debounce effect below keys
    //    off `Boolean(suggest)` (presence, not identity) so that churn can't
    //    restart the 150ms timer — but it still needs to invoke whichever
    //    `suggest` closure is freshest when the timer actually fires.
    const onSearchRef = useRef(onSearch);
    const suggestRef = useRef(suggest);
    // `seeds` is typically a freshly-computed array at the call site too (no
    // memo) — same churn as `suggest`, so it gets the same ref treatment:
    // the effect below keys off presence (`Boolean(seeds?.length)`), and
    // reads the latest array through this ref, so a parent re-render can't
    // reset the seed list's identity mid-keyboard-nav (which would also
    // reset `activeIndex` via the "suggestions changed" effect below).
    const seedsRef = useRef(seeds);
    useEffect(() => {
        onSearchRef.current = onSearch;
        suggestRef.current = suggest;
        seedsRef.current = seeds;
    });
    // Monotonic generation guard for the async `suggest` path (same shape as
    // FitIntentGuard in app/page.tsx): only the response from the LAST
    // effect run gets to update state, so a slow, stale response can't
    // clobber a faster, newer one. Bumped from the effect's CLEANUP — every
    // branch below (closed, empty query, and the debounced fetch) returns
    // through it, so a hole can't reopen if a branch is added later. Bumping
    // only inside the fetch branch (as a first pass did) left the `!isOpen`
    // and empty-query early returns un-invalidating: type "engineer", wait
    // >150ms for the request to fire, select-all + delete — the in-flight
    // response still matched the (unbumped) generation and repopulated the
    // now-empty box with "engineer" suggestions.
    const suggestGenRef = useRef(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const showSuggestLoading = Boolean(suggest) && isOpen && value.trim().length > 0 && suggestLoading;
    const showClear = Boolean(onClear) && value.length > 0;
    const dropdownOpen = isOpen && (suggestions.length > 0 || showSuggestLoading);
    const overlayRect = useAnchoredOverlayRect(anchorRef, dropdownOpen);
    useImperativeHandle(
        ref,
        () => ({
            close: () => setIsOpen(false),
            focus: () => inputRef.current?.focus(),
        }),
        [],
    );

    // Update suggestions
    useEffect(() => {
        const myGeneration = suggestGenRef.current;
        const invalidate = () => {
            suggestGenRef.current += 1;
        };

        if (!isOpen) return invalidate;

        if (suggest) {
            const q = value.trim();
            if (!q) {
                setSuggestLoading(false);
                const seedList = seedsRef.current;
                setSuggestions(seedList && seedList.length > 0 ? seedList.map((s) => ({ text: s, type: "seed" as const })) : []);
                return invalidate;
            }
            setSuggestLoading(true);
            const timer = setTimeout(() => {
                const fn = suggestRef.current;
                if (!fn) return;
                fn(q)
                    .then((results) => {
                        if (suggestGenRef.current === myGeneration) setSuggestions(results);
                    })
                    .catch(() => {
                        if (suggestGenRef.current === myGeneration) setSuggestions([]);
                    })
                    .finally(() => {
                        if (suggestGenRef.current === myGeneration) setSuggestLoading(false);
                    });
            }, 150);
            return () => {
                clearTimeout(timer);
                invalidate();
            };
        }

        const timer = setTimeout(() => {
            if (value.trim() === "") {
                setSuggestions(history.slice(0, 5).map(h => ({ text: h, type: 'history' })));
            } else {
                setSuggestions(getSuggestions(value, history));
            }
        }, 0);
        return () => {
            clearTimeout(timer);
            invalidate();
        };
        // `Boolean(suggest)`/`Boolean(seeds?.length)` (presence), not the
        // array/function identities — see the `suggestRef`/`seedsRef`
        // comment above. This is what makes the debounce mean "150ms after
        // the last keystroke", not "150ms after the last parent render".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, history, isOpen, Boolean(suggest), Boolean(seeds && seeds.length > 0)]);

    // Reset the highlighted item whenever the suggestion LIST itself changes
    // (a new debounced/async result set, or the sync source recomputing) —
    // otherwise a stale index left over from a longer previous list can
    // point past the end of a shorter new one, or land on a different item
    // than what's rendered highlighted, and Enter would silently fall
    // through to raw-text submit instead of selecting what's shown.
    useEffect(() => {
        setActiveIndex(-1);
    }, [suggestions]);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // Bubble up arrow keys only if dropdown is open and has items
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isOpen && suggestions.length > 0) {
            e.preventDefault();
            if (e.key === "ArrowDown") {
                setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
            } else {
                setActiveIndex(prev => (prev > 0 ? prev - 1 : -1));
            }
        } else if (e.key === "Enter") {
            if (isOpen && activeIndex >= 0 && suggestions[activeIndex]) {
                e.preventDefault();
                handleSelect(suggestions[activeIndex].text);
            } else {
                setIsOpen(false);
                onSearchRef.current();
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
        }
    };

    const handleSelect = (text: string) => {
        onChange(text);
        setIsOpen(false);

        // No history bookkeeping here — the shared store (see the `history`
        // read above) is written once per COMMITTED search at the caller's
        // `onSearch` chokepoint, which this select funnels into below, so a
        // pick and a typed Enter are recorded identically.

        // Wait a tick so the parent's re-render (triggered by the `onChange`
        // above) lands before we search — `onSearchRef` always holds the
        // latest `onSearch` closure, so this reads the post-selection value.
        setTimeout(() => onSearchRef.current(), 0);
    };

    return (
        <div ref={anchorRef} className={cn("relative group", containerClassName)}>
            {/* The glyph is a FLEX SIBLING of the field, never an absolutely
                positioned overlay with `pl-*` on the input holding the text
                clear of it. That older shape coupled the component and its
                callers on one shared tailwind-merge axis — padding — so any
                caller passing `px-*` silently deleted the `pl-*` and the icon
                landed on the placeholder's first word: no error, just a broken
                field. As row siblings they cannot overlap by construction and
                callers own their own padding again. `jobs-first-screen.spec.ts`
                ("no glyph painted over the search field overlaps where its text
                starts") measures this and is the regression gate. */}
            <div className="relative flex h-full w-full items-center">
                {leadingIcon && (
                    <span aria-hidden className="pointer-events-none flex shrink-0 items-center pl-3.5 text-muted-foreground">
                        {leadingIcon}
                    </span>
                )}
                <Input
                    ref={inputRef}
                    type="text"
                    aria-label={ariaLabel}
                    placeholder={placeholder}
                    className={cn(
                        "relative z-20 transition-all",
                        leadingIcon && "min-w-0 flex-1",
                        // Must clear the button's own footprint (inset + size),
                        // which differs per breakpoint below: mobile needs
                        // right-1.5 (6px) + w-10 (40px) = 46px -> pr-12 (48px);
                        // lg needs lg:right-2.5 (10px) + lg:w-6 (24px) = 34px
                        // -> lg:pr-9 (36px). A single non-responsive value here
                        // either clips the button's own breakpoint or leaves
                        // slack under the other one.
                        showClear && "pr-12 lg:pr-9",
                        className,
                    )}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setIsOpen(true);
                        setActiveIndex(-1);
                    }}
                    onFocus={() => setIsOpen(true)}
                    // Item 6e (2026-08-21): closes the dropdown on blur —
                    // tab away, click elsewhere, or click a suggestion (each
                    // `<li>` below prevents the mousedown that would
                    // otherwise fire this BEFORE the click's own `onClick`
                    // runs) — replacing the separate click-outside
                    // listener this component used to carry: blur already
                    // covers every case that did, and one source of truth
                    // for "did focus leave the field" beats two.
                    onBlur={() => setIsOpen(false)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    autoFocus={autoFocus}
                />
                {/* z-30, strictly above the Input's z-20 — a sibling with a
                    LOWER z-index here lost hit-testing to the (visually
                    transparent) Input on top of it, which is the exact bug
                    this button fixes. Kept inside this same shallow wrapper
                    (not `containerClassName`) so it shares the Input's own
                    stacking context rather than the caller's. */}
                {showClear && (
                    <button
                        type="button"
                        data-testid="search-input-clear"
                        aria-label="Clear search"
                        title="Clear search"
                        // Same guard as the suggestion `<li>` items above and
                        // the sibling `topbar-docked-location-clear` button:
                        // without it, mousedown moves focus to this button
                        // before onClick fires, blurring the Input. Touch taps
                        // are unaffected — they fire their own click regardless
                        // of what a mousedown handler does.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onClear?.()}
                        className="absolute right-1.5 z-30 flex h-10 w-10 items-center justify-center rounded-ctl bg-muted text-muted-foreground transition-colors hover:text-foreground lg:right-2.5 lg:h-6 lg:w-6"
                    >
                        <X size={20} aria-hidden />
                    </button>
                )}
            </div>

            {/* Portaled so clipped ancestors (docked header `overflow-hidden`)
                cannot hide suggestions. */}
            {dropdownOpen &&
                overlayRect &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        className="fixed z-[100] overflow-hidden border border-border-strong bg-popover shadow-[var(--shadow-overlay)] animate-in fade-in slide-in-from-top-1"
                        style={{
                            top: overlayRect.top,
                            left: overlayRect.left,
                            width: overlayRect.width,
                        }}
                    >
                        <ul role="listbox" aria-label="Search suggestions" className="max-h-[300px] overflow-y-auto py-2">
                            {showSuggestLoading && (
                                <li role="status" aria-busy="true" className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
                                    <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />
                                    Loading suggestions…
                                </li>
                            )}
                            {suggestions.map((suggestion, index) => {
                                const label = SECTION_LABELS[suggestion.type];
                                const showLabel = label && (index === 0 || suggestions[index - 1]?.type !== suggestion.type);
                                const segments = highlightMatch(suggestion.text, value);
                                return (
                                    <Fragment key={index}>
                                        {showLabel && (
                                            <li aria-hidden className="whitespace-nowrap px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
                                                {label}
                                            </li>
                                        )}
                                        <li
                                            role="option"
                                            aria-selected={index === activeIndex}
                                            className={cn(
                                                "flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors",
                                                index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            )}
                                            onClick={() => handleSelect(suggestion.text)}
                                            onMouseEnter={() => setActiveIndex(index)}
                                            onMouseDown={(e) => e.preventDefault()}
                                        >
                                            {suggestion.type === "history" ? (
                                                <Clock size={16} className="shrink-0 opacity-70" />
                                            ) : suggestion.type === "company" ? (
                                                <Buildings size={16} className="shrink-0 opacity-70" />
                                            ) : (
                                                <MagnifyingGlass size={16} className="shrink-0 opacity-70" />
                                            )}
                                            <span className="flex-1 truncate">
                                                {segments.map((seg, i) =>
                                                    seg.matched ? (
                                                        <mark key={i} className="bg-transparent font-semibold text-foreground">
                                                            {seg.text}
                                                        </mark>
                                                    ) : (
                                                        <span key={i}>{seg.text}</span>
                                                    ),
                                                )}
                                            </span>
                                            {index === activeIndex && <CaretRight className="opacity-50" />}
                                        </li>
                                    </Fragment>
                                );
                            })}
                        </ul>
                    </div>,
                    document.body,
                )}
        </div>
    );
});
