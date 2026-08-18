"use client";

import { useState, useEffect, useRef, useSyncExternalStore, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Clock, MagnifyingGlass, Buildings, CaretRight } from "@phosphor-icons/react";
import { getSuggestions, SearchSuggestion } from "@/lib/search-suggestions";
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
    placeholder?: string;
    disabled?: boolean;
    className?: string; // Class for the Input
    containerClassName?: string;
    autoFocus?: boolean;
    leadingIcon?: React.ReactNode;
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

export function SearchAutocomplete({
    value,
    onChange,
    onSearch,
    placeholder,
    disabled,
    className,
    containerClassName,
    autoFocus,
    leadingIcon,
    suggest,
    seeds
}: SearchAutocompleteProps) {
    const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
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
    const containerRef = useRef<HTMLDivElement>(null);
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
                const seedList = seedsRef.current;
                setSuggestions(seedList && seedList.length > 0 ? seedList.map((s) => ({ text: s, type: "seed" as const })) : []);
                return invalidate;
            }
            const timer = setTimeout(() => {
                const fn = suggestRef.current;
                if (!fn) return;
                fn(q)
                    .then((results) => {
                        if (suggestGenRef.current === myGeneration) setSuggestions(results);
                    })
                    .catch(() => {
                        if (suggestGenRef.current === myGeneration) setSuggestions([]);
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

    // Click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

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
        <div className={cn("relative group", containerClassName)} ref={containerRef}>
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
            <div className="relative flex w-full items-center">
                {leadingIcon && (
                    <span aria-hidden className="pointer-events-none flex shrink-0 items-center pl-3.5 text-muted-foreground/70">
                        {leadingIcon}
                    </span>
                )}
                <Input
                    type="text"
                    placeholder={placeholder}
                    className={cn("relative z-20 transition-all", leadingIcon && "min-w-0 flex-1", className)}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setIsOpen(true);
                        setActiveIndex(-1);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    autoFocus={autoFocus}
                />
            </div>

            {/* Dropdown */}
            {isOpen && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-1">
                    {suggestions[0]?.type === 'seed' && (
                        <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Popular searches
                        </p>
                    )}
                    <ul role="listbox" aria-label="Search suggestions" className="py-2 max-h-[300px] overflow-y-auto">
                        {suggestions.map((suggestion, index) => (
                            <li
                                key={index}
                                role="option"
                                aria-selected={index === activeIndex}
                                className={cn(
                                    "px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-sm",
                                    index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                )}
                                onClick={() => handleSelect(suggestion.text)}
                                onMouseEnter={() => setActiveIndex(index)}
                            >
                                {suggestion.type === 'history' ? (
                                    <Clock size={16} className="shrink-0 opacity-70" />
                                ) : suggestion.type === 'company' ? (
                                    <Buildings size={16} className="shrink-0 opacity-70" />
                                ) : (
                                    <MagnifyingGlass size={16} className="shrink-0 opacity-70" />
                                )}
                                <span className="flex-1 truncate">
                                    {suggestion.text}
                                </span>
                                {index === activeIndex && (
                                    <CaretRight size={14} className="opacity-50" />
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
