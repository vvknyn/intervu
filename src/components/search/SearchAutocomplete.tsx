"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, useImperativeHandle, forwardRef, type CSSProperties, type KeyboardEvent, type Key } from "react";
import type { ComboBoxState } from "react-aria-components";
import { Combobox, ComboboxInput, ComboboxItem, ComboboxLayer, ComboboxList, ComboboxPopover, ComboboxSection } from "@/components/ui/combobox";
import { ArrowLeft, Clock, MagnifyingGlass, Buildings, CaretRight, X } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { getSuggestions, groupSuggestions, withQueryRow, SearchSuggestion, SuggestionRow, SuggestionSection } from "@/lib/search-suggestions";
import { highlightMatch } from "@/lib/highlight-match";
import {
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
} from "@/lib/jobs/recent-searches";
import { LG_UP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useVisibleViewport } from "@/hooks/use-visual-viewport";
import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils";

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
    /** The field's name in a surrounding `<form>`, which submits it before
     *  the page's code has run (the server-drawn /jobs front door). */
    name?: string;
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

// Fixed to the screen (dvh); while open it follows the visible viewport instead, see `useVisibleViewport`; the padding keeps the top row clear of a notch.
const LAYER_STYLE: CSSProperties = {
    position: "fixed",
    inset: 0,
    height: "100dvh",
    paddingTop: "env(safe-area-inset-top)",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
};

/** The words a row reads as: the raw-text row names the search it runs. */
const rowLabel = (row: SearchSuggestion) => (row.type === "query" ? `Search \u201c${row.text}\u201d` : row.text);

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
    ariaLabel = "Search jobs",
    name,
}, ref) {
    const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
    const [suggestLoading, setSuggestLoading] = useState(false);
    // The source rejected: told apart from "no matches", which is an empty list.
    const [suggestFailed, setSuggestFailed] = useState(false);
    // Whether the list is open — the combobox's own open state, reported
    // through `onOpenChange`, and the ONE state for "open": the phone layer below
    // is derived from it, so no path can open or close one without the other.
    // It stays true while the list has nothing to show (`allowsEmptyCollection`),
    // so a typed query can fetch the suggestions that will fill it.
    const [isOpen, setIsOpen] = useState(false);
    // Below `lg` the focused field becomes the standard full-screen search view
    // (back arrow + field on top, full-width rows below). The layer is a CSS
    // switch on the SAME elements, never a second input: iOS opens the keyboard
    // only for focus that happens inside the tap, so the input that took the tap
    // must be the one that stays mounted and focused.
    const compact = !useMediaQuery(LG_UP_QUERY);
    const layer = compact && isOpen;
    const visible = useVisibleViewport(layer);
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
    const comboboxStateRef = useRef<ComboBoxState<SuggestionSection> | null>(null);
    const showSuggestLoading = Boolean(suggest) && isOpen && value.trim().length > 0 && suggestLoading;
    const showClear = Boolean(onClear) && value.length > 0;
    const rows = useMemo(() => withQueryRow(value, suggestions), [value, suggestions]);
    const sections = useMemo(() => groupSuggestions(rows), [rows]);
    const showSuggestFailed = Boolean(suggest) && isOpen && value.trim().length > 0 && !suggestLoading && suggestFailed;
    useImperativeHandle(
        ref,
        () => ({
            close: () => comboboxStateRef.current?.close(),
            focus: () => inputRef.current?.focus(),
        }),
        [],
    );

    // The page behind the layer must not scroll under a finger on the list.
    useEffect(() => {
        if (!layer) return;
        const { body, documentElement: html } = document;
        const prev = [body.style.overflow, html.style.overflow];
        body.style.overflow = html.style.overflow = "hidden";
        return () => {
            [body.style.overflow, html.style.overflow] = prev;
        };
    }, [layer]);

    // A server-drawn box can be typed in before the page's code runs. That
    // text is still in the field when it hydrates; take it as the value, or
    // the next render would write the old value over it.
    useLayoutEffect(() => {
        const typed = inputRef.current?.value;
        if (typed && typed !== value) onChange(typed);
        // Mount only: afterwards the field and `value` move together.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            setSuggestFailed(false);
            const timer = setTimeout(() => {
                const fn = suggestRef.current;
                if (!fn) return;
                fn(q)
                    .then((results) => {
                        if (suggestGenRef.current === myGeneration) setSuggestions(results);
                    })
                    .catch(() => {
                        if (suggestGenRef.current !== myGeneration) return;
                        setSuggestions([]);
                        setSuggestFailed(true);
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

    // The one rule for what Enter runs: the words in the box. The combobox
    // highlights a row ONLY from the arrow keys — the list sets
    // `shouldFocusOnHover={false}`, so the pointer just paints `data-hovered` —
    // and reports it as `aria-activedescendant`; so Enter runs a suggestion
    // exactly when the person picked one with the arrow keys (the library selects
    // it, `onSelectionChange` below runs it), and otherwise searches the free
    // text. The library's default is to focus the hovered row, so a pointer
    // resting where the list opened made "accountant" + Enter search whatever
    // row was under it.
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter" || e.currentTarget.hasAttribute("aria-activedescendant")) return;
        // `onSearch` is the search; a surrounding form must not submit it a second time.
        e.preventDefault();
        comboboxStateRef.current?.close();
        // Full-screen search is done: the keyboard drops so the results show. The desktop box keeps the cursor.
        if (compact) e.currentTarget.blur();
        onSearchRef.current();
    };

    // The library hands focus back to the field after a pick; that is not a new
    // visit to it. Set by a pick, cleared by the next press on the field or blur.
    const pickedRef = useRef(false);
    const pressOnFocusedRef = useRef(false);
    const openLayer = () => {
        if (compact) comboboxStateRef.current?.open(null, "focus");
    };

    const handleSelect = (key: Key | null) => {
        const picked = key == null ? undefined : rows[Number(key)];
        if (!picked) return;
        onChange(picked.text);

        // No history bookkeeping here — the shared store (see the `history`
        // read above) is written once per COMMITTED search at the caller's
        // `onSearch` chokepoint, which this select funnels into below, so a
        // pick and a typed Enter are recorded identically.

        // Wait a tick so the parent's re-render (triggered by the `onChange`
        // above) lands before we search — `onSearchRef` always holds the
        // latest `onSearch` closure, so this reads the post-selection value.
        // The same tick closes the list: the library opens it on ANY change
        // of the controlled text while focused, including the one above, so a
        // close issued before the re-render would be undone by it.
        pickedRef.current = true;
        setTimeout(() => {
            comboboxStateRef.current?.close();
            onSearchRef.current();
        }, 0);
    };

    const suggestionList = (
        <>
                    <ComboboxList aria-label="Search suggestions" shouldFocusOnHover={false} className={layer ? "max-h-none" : undefined}>
                        {(section: SuggestionSection) => (
                            <ComboboxSection key={section.id} id={section.id} aria-label={section.label ?? "Suggestions"} heading={section.label} items={section.rows}>
                                {(row: SuggestionRow) => (
                                    <ComboboxItem id={row.id} textValue={rowLabel(row)}>
                                        {({ isFocused }) => (
                                            <>
                                                {row.type === "history" ? (
                                                    <Clock size={16} className="shrink-0 opacity-70" />
                                                ) : row.type === "company" ? (
                                                    <Buildings size={16} className="shrink-0 opacity-70" />
                                                ) : (
                                                    <MagnifyingGlass size={16} className="shrink-0 opacity-70" />
                                                )}
                                                <span className="flex-1 truncate">
                                                    {row.type === "query"
                                                        ? rowLabel(row)
                                                        : highlightMatch(row.text, value).map((seg, i) =>
                                                            seg.matched ? (
                                                                <mark key={i} className="bg-transparent font-semibold text-foreground">
                                                                    {seg.text}
                                                                </mark>
                                                            ) : (
                                                                <span key={i}>{seg.text}</span>
                                                            ),
                                                        )}
                                                </span>
                                                {isFocused && <CaretRight className="opacity-50" />}
                                            </>
                                        )}
                                    </ComboboxItem>
                                )}
                            </ComboboxSection>
                        )}
                    </ComboboxList>
                    {showSuggestLoading && (
                        <div role="status" aria-busy="true" className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
                            <InlineSpinner size={16} className="shrink-0" />
                            Loading suggestions…
                        </div>
                    )}
                    {showSuggestFailed && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Suggestions are unavailable right now.</p>}
        </>
    );

    return (
        <Combobox
            ref={anchorRef}
            stateRef={comboboxStateRef}
            className={containerClassName}
            aria-label={ariaLabel}
            name={name}
            isDisabled={disabled}
            // Free text searches (Enter), a suggestion is only a shortcut to it.
            // `selectedKey` stays null so picking the same row twice still
            // fires: a pick is an action, not a value the field remembers.
            selectedKey={null}
            onSelectionChange={handleSelect}
            inputValue={value}
            onInputChange={onChange}
            items={sections}
            menuTrigger="focus"
            allowsEmptyCollection
            onOpenChange={setIsOpen}
        >
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
            {/* Two wrappers that vanish (`contents`) at rest and on desktop, so the
                field sits exactly where it always did. Below `lg` while open the
                outer one is the full-viewport layer (inline style: position is
                what makes it a layer, so it must not depend on a class) and the
                inner one its top row. The input is the same node in both. */}
            <ComboboxLayer
                active={layer}
                data-search-layer={layer ? "" : undefined}
                style={layer ? { ...LAYER_STYLE, ...(visible && { top: visible.top, bottom: "auto", height: visible.height }) } : undefined}
                className={layer ? "z-[var(--z-sheet)] flex flex-col bg-background animate-in fade-in motion-reduce:animate-none" : "contents"}
            >
            <div className={layer ? "flex shrink-0 items-center gap-1 px-2 py-2" : "contents"}>
            {layer && (
                <button
                    type="button"
                    aria-label="Close search"
                    // Back leaves search, as in native full-screen search: the list closes
                    // and focus moves off the field to this button (Safari does not focus buttons on tap),
                    // so the keyboard drops. (Escape keeps the focus.) The button sits inside
                    // the list surface, so the library does not close on that blur by itself.
                    onClick={(e) => {
                        e.currentTarget.focus();
                        comboboxStateRef.current?.close();
                    }}
                    className={cn("flex size-11 shrink-0 items-center justify-center text-foreground", CONTROL_FOCUS_VISIBLE)}
                >
                    <ArrowLeft size={20} aria-hidden />
                </button>
            )}
            <div className={cn("relative flex h-full w-full items-center", layer && "h-11 min-w-0 flex-1 rounded-pill bg-surface-3")}>
                {leadingIcon && (
                    <span aria-hidden className="pointer-events-none flex shrink-0 items-center pl-3.5 text-muted-foreground">
                        {leadingIcon}
                    </span>
                )}
                <ComboboxInput
                    ref={inputRef}
                    type="text"
                    placeholder={placeholder}
                    className={cn(
                        "relative z-20 overflow-hidden text-ellipsis transition-all",
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
                        // Last, so it wins over a caller's own size: the layer's field is a
                        // 44px row; 16px type keeps iOS from zooming the page on focus.
                        layer && "h-11 text-base",
                    )}
                    enterKeyHint="search"
                    onFocus={() => !pickedRef.current && openLayer()}
                    // A press that STARTS on a field that already has focus (after Escape) fires no
                    // focus event, so it opens at the END of the press (click). The layer moves the
                    // field: moved under a finger still down, WebKit drops its focus. Only such a
                    // press counts, so neither a pick's click (it lands on the field below the closing
                    // layer) nor the late click of the press that took focus can reopen the layer.
                    // An unfocused field opens on its focus event instead: moving it before it
                    // takes focus makes WebKit drop the focus (no keyboard).
                    onPointerDown={(e) => {
                        pickedRef.current = false;
                        pressOnFocusedRef.current = document.activeElement === e.currentTarget;
                    }}
                    onClick={() => {
                        if (!pressOnFocusedRef.current) return;
                        pressOnFocusedRef.current = false;
                        openLayer();
                    }}
                    onBlur={() => {
                        pickedRef.current = false;
                    }}
                    onKeyDown={handleKeyDown}
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
                        // Without this, mousedown moves focus to this button
                        // before onClick fires, blurring the Input. Touch taps
                        // are unaffected — they fire their own click regardless
                        // of what a mousedown handler does.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onClear?.()}
                        className={cn(
                            "absolute right-1.5 z-30 flex ctl-sm ctl-button ctl-square items-center justify-center text-muted-foreground transition-colors hover:text-foreground lg:right-2.5",
                            CONTROL_FOCUS_VISIBLE,
                        )}
                    >
                        <X size={16} aria-hidden />
                    </button>
                )}
            </div>

            </div>
            {layer ? (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                    {suggestionList}
                </div>
            ) : (
                (rows.length > 0 || showSuggestLoading) && (
                    <ComboboxPopover triggerRef={anchorRef}>{suggestionList}</ComboboxPopover>
                )
            )}
            </ComboboxLayer>
        </Combobox>
    );
});
