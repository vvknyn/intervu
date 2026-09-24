"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAnchoredOverlayRect } from "@/lib/use-anchored-overlay-rect";
import { Input } from "@/components/ui/input";
import { Check, CircleNotch } from "@phosphor-icons/react";
import { highlightMatch } from "@/lib/highlight-match";
import {
    countryCommitFieldForQuery,
    isLocationSelected,
    prioritizeCountryMatch,
} from "@/lib/jobs/location-suggest";
import { splitLocationLabel } from "@/lib/presentation/location";
import { LOCATION_TRIGGER_PLACEHOLDER } from "@/components/jobs/FilterPanel";
import type { LocationSuggestGroup, LocationSuggestion, SuggestField } from "@/lib/jobs/location-suggest";
import { cn } from "@/lib/utils";

/**
 * The desktop location control: a combobox over the places this corpus
 * actually has, replacing the bare text input that shipped before it.
 *
 * Two things that input could not do, both reported as missing:
 *
 * 1. **No dropdown.** A searcher had to already know how this corpus spells a
 *    place, with no way to see whether it holds any postings. The counts here
 *    are the point — they answer "is it worth filtering on this" before the
 *    filter runs, and they are summed across spellings, so Montréal and
 *    Montreal are one row rather than two thirds of a city each.
 *
 * 2. **No way to filter on more than one place.** The corpus, the URL
 *    (`?country=a,b`) and place resolution have all supported a LIST the
 *    whole time — only this control collapsed it to one value.
 *
 * Committed places are NOT rendered inside this field. They render as
 * ordinary filter chips, alongside every other active filter, because that
 * row already exists and already knows how to remove one. A second, private
 * set of removable tokens living in here would be the duplicate-affordance
 * regression the chips row was cleaned of on 2026-08-15 — and would mean two
 * places to look for the same fact.
 */

const DEBOUNCE_MS = 150;

interface LocationComboboxProps {
    /** The in-progress text. Committed places live in `selected`, not here. */
    value: string;
    onChange: (value: string) => void;
    /** Commit a value to the filter. Passed the corpus's own spelling when a
     *  suggestion is picked (with the facet it targets — omitted, meaning
     *  `location_country`, on a free-text Enter/blur, since raw text is
     *  never known to be anything else). */
    onCommit: (value: string, field?: SuggestField) => void;
    /** Already-filtered places, so their rows can render as chosen rather
     *  than inviting a second, no-op click. */
    selected: readonly string[];
    /** Focus entering this field — the jobs page uses it to close the
     *  KEYWORD box's suggestion panel, which otherwise has no idea focus
     *  moved to a sibling and keeps floating its title suggestions over a
     *  user who is now typing a city (prod bug, 2026-09-22). */
    onFocus?: () => void;
    placeholder?: string;
    className?: string;
    containerClassName?: string;
    "data-testid"?: string;
    /** Accessible name for the underlying `<input>` — it has no visible
     *  `<label>`, only a placeholder that changes once a place is chosen. */
    ariaLabel?: string;
}

/** Flatten groups to the flat list keyboard navigation moves through — the
 *  headers are not stops. */
/**
 * One suggestion's visible text. The row is a single truncating line, so the
 * part that tells two suggestions apart has to sit at the START of it —
 * `splitLocationLabel` decides which part that is (see its doc for the prod
 * rows that forced this: two St. Louis sites rendering identically because
 * the ellipsis ate the only difference between them).
 *
 * `label` itself is untouched — it stays the corpus's own string, which is
 * what the row commits, compares and filters on. This is display only.
 */
function SuggestionLabel({ label, query }: { label: string; query: string }) {
    const { lead, context } = splitLocationLabel(label);
    const paint = (text: string, matchClass: string) =>
        highlightMatch(text, query).map((seg, si) => (
            <span key={si} className={seg.matched ? matchClass : undefined}>
                {seg.text}
            </span>
        ));
    return (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
            {/* The cap exists only to leave room for the context column beside
                it. A value with no context is the whole row — capping it there
                too would truncate labels that used to fit ("North America Or
                Europe" and "North America And Europe" both cut to "North
                America …" at 60% width, measured on prod). */}
            <span className={cn("truncate", context ? "max-w-[60%] shrink-0" : "min-w-0 flex-1")}>
                {paint(lead, "font-semibold text-foreground")}
            </span>
            {context && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {paint(context, "font-semibold")}
                </span>
            )}
        </span>
    );
}

function flatten(groups: LocationSuggestGroup[]): LocationSuggestion[] {
    return groups.flatMap((g) => g.items);
}

export function LocationCombobox({
    value,
    onChange,
    onCommit,
    selected,
    onFocus,
    placeholder = LOCATION_TRIGGER_PLACEHOLDER,
    className,
    containerClassName,
    "data-testid": testId = "location-input",
    ariaLabel = "Location",
}: LocationComboboxProps) {
    const [groups, setGroups] = useState<LocationSuggestGroup[]>([]);
    const [fetching, setFetching] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);

    // Monotonic guard: a slow response for an earlier keystroke must never
    // overwrite a faster one for a later keystroke. Same reasoning as
    // SearchAutocomplete's generation counter.
    const generation = useRef(0);
    /** Set on suggestion mousedown so blur does not free-text-commit before
     *  the click's field-scoped commit runs (standard combobox guard). */
    const pickingRef = useRef(false);
    const anchorRef = useRef<HTMLDivElement>(null);
    const hasSuggestions = groups.some((g) => g.items.length > 0);
    const showLoading = isOpen && value.trim().length > 0 && fetching;
    const overlayRect = useAnchoredOverlayRect(anchorRef, isOpen && (hasSuggestions || showLoading));

    useEffect(() => {
        const q = value.trim();
        if (!q) {
            setGroups([]);
            setFetching(false);
            setActiveIndex(-1);
            return;
        }
        const mine = ++generation.current;
        setFetching(true);
        const timer = setTimeout(() => {
            fetch(`/api/jobs/locations?q=${encodeURIComponent(q)}`)
                .then((r) => (r.ok ? r.json() : { groups: [] }))
                .then((body: { groups?: LocationSuggestGroup[] }) => {
                    if (mine !== generation.current) return;
                    setGroups(prioritizeCountryMatch(body.groups ?? [], q));
                    setActiveIndex(-1);
                })
                // Suggestions are an accelerant, never a source of error —
                // a failed lookup leaves the field a plain text input,
                // which is exactly what it was before this component.
                .catch(() => {
                    if (mine === generation.current) setGroups([]);
                })
                .finally(() => {
                    if (mine === generation.current) setFetching(false);
                });
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [value]);

    const commit = useCallback(
        (next: string, field?: SuggestField) => {
            pickingRef.current = false;
            onCommit(next, field);
            onChange("");
            setGroups([]);
            setActiveIndex(-1);
            setIsOpen(false);
        },
        [onCommit, onChange],
    );

    const items = flatten(groups);
    const open = isOpen && (items.length > 0 || showLoading);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            setIsOpen(false);
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!open) return;
            e.preventDefault();
            const delta = e.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((i) => {
                const next = i + delta;
                if (next < 0) return items.length - 1;
                if (next >= items.length) return 0;
                return next;
            });
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            // A highlighted row wins; otherwise commit exactly what was
            // typed. The free-text path is deliberately kept: place
            // resolution understands phrases this facet-search dropdown
            // never offers ("remote canada", "bay area"), and removing it
            // would narrow what the box accepts in the name of adding a
            // dropdown to it.
            const picked = activeIndex >= 0 ? items[activeIndex] : undefined;
            const next = picked ? picked.label : value.trim();
            if (!next) return;
            const field =
                picked?.field ?? countryCommitFieldForQuery(groups, next);
            commit(next, field);
        }
    };

    const suggestionList = (
        <ul id="location-suggestions" role="listbox" aria-label="Location suggestions" className="max-h-[300px] overflow-y-auto py-2">
            {showLoading && (
                <li role="status" aria-busy="true" className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
                    <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />
                    Loading locations…
                </li>
            )}
            {groups.map((group) => {
                const firstIndex = groups
                    .slice(0, groups.indexOf(group))
                    .reduce((n, g) => n + g.items.length, 0);
                return (
                    <Fragment key={group.field}>
                        <li aria-hidden className="px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
                            {group.heading}
                        </li>
                        {group.items.map((item, i) => {
                            const index = firstIndex + i;
                            const chosen = isLocationSelected(item, selected);
                            return (
                                <li
                                    key={item.key}
                                    role="option"
                                    aria-selected={index === activeIndex}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                                        index === activeIndex
                                            ? "bg-muted text-foreground"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        pickingRef.current = true;
                                    }}
                                    onClick={() => commit(item.label, item.field)}
                                >
                                    <SuggestionLabel label={item.label} query={value} />
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {item.count.toLocaleString()}
                                    </span>
                                    {chosen && <Check weight="bold" className="shrink-0 text-foreground" aria-label="Already filtered" />}
                                </li>
                            );
                        })}
                    </Fragment>
                );
            })}
        </ul>
    );

    return (
        <div ref={anchorRef} className={cn("relative flex min-w-0 flex-1", containerClassName)}>
            <Input
                data-testid={testId}
                type="text"
                role="combobox"
                aria-label={ariaLabel}
                aria-expanded={open}
                aria-autocomplete="list"
                // Only reference the listbox while it is actually mounted —
                // a dangling `aria-controls` id lets assistive tech fall
                // back to whatever other listbox is visible (the keyword
                // box's, in the observed bug).
                aria-controls={open ? "location-suggestions" : undefined}
                placeholder={selected.length > 0 ? "Add another location" : placeholder}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => {
                    onFocus?.();
                    setIsOpen(true);
                }}
                // Blur closes AND commits whatever was typed. Committing on
                // blur is kept from the plain input this replaced: without it,
                // typing a city and clicking "Search" — never pressing Enter —
                // would silently drop the location. A suggestion click does not
                // reach here, because each row prevents the mousedown that
                // would blur the field first (the standard combobox fix, same
                // as SearchAutocomplete's).
                onBlur={() => {
                    setIsOpen(false);
                    if (pickingRef.current) {
                        pickingRef.current = false;
                        return;
                    }
                    const typed = value.trim();
                    if (typed) commit(typed, countryCommitFieldForQuery(groups, typed));
                }}
                onKeyDown={handleKeyDown}
                className={className}
            />

            {/* Portaled so `overflow-hidden` on the docked header search form
                cannot clip suggestions — same panel chrome as before. */}
            {open &&
                overlayRect &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        className="fixed z-[100] min-w-[280px] overflow-hidden border border-border-strong bg-popover animate-in fade-in slide-in-from-top-1"
                        style={{
                            top: overlayRect.top,
                            left: overlayRect.left,
                            width: Math.max(280, overlayRect.width),
                        }}
                    >
                        {suggestionList}
                    </div>,
                    document.body,
                )}
        </div>
    );
}
