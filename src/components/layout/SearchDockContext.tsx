"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

/**
 * What the header renders once a page's own search is the thing in play.
 *
 * The seam is deliberately narrow: the header does NOT know what a job search
 * is, what Meili is, or which page published this. It renders a controlled
 * text field, an optional place segment, and an optional row of dismissible
 * chips plus a filter-count button — generic controls with no notion of
 * "job", "facet", or "board" attached. Any page that owns a search can dock
 * into the same slot without TopBar growing a second code path.
 *
 * `null` means nothing is docked and the header keeps its normal layout.
 */
export type DockedSearchChip = {
    /** Stable identity for the chip — round-trips to `onClearChip`. */
    key: string;
    label: string;
};

export type DockedSearch = {
    /** The field's current text. Controlled — the header renders exactly this. */
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    /** Every filter currently narrowing the search, for a dismissible chip each. */
    chips: DockedSearchChip[];
    onClearChip: (key: string) => void;
    /** Badge count on the "Filters" button — 0 renders no badge, per house style. */
    filterCount: number;
    /** Whether the page's filter panel is currently expanded. */
    filtersExpanded: boolean;
    /** Toggles the page's own filter panel/sheet. */
    onOpenFilters: () => void;
    /**
     * One short piece of standing context for this search, shown beside the
     * filter controls. Deliberately `label` + optional `href` and nothing
     * else: the header stays ignorant of what is being counted, same as it is
     * for `chips`. Omitted renders nothing — there is no empty state.
     */
    status?: { label: string; href?: string };
} | null;

type DockValue = {
    docked: DockedSearch;
    setDocked: (next: DockedSearch) => void;
    /**
     * Separate from `docked`: the For-you/Search toggle sits on the header
     * row beside the mark at every width, including For you (no query, no
     * filters — `docked` stays `null`) and Search before a query is typed.
     * It must not open the filter band. Folding this into `docked` would
     * make a Search-only concern also mean "is the toggle showing."
     */
    homeViewDocked: boolean;
    setHomeViewDocked: (next: boolean) => void;
};

const SearchDockCtx = createContext<DockValue>({
    docked: null,
    setDocked: () => {},
    homeViewDocked: false,
    setHomeViewDocked: () => {},
});

export function SearchDockProvider({ children }: { children: React.ReactNode }) {
    const [docked, setDocked] = useState<DockedSearch>(null);
    const [homeViewDocked, setHomeViewDocked] = useState(false);
    // Memoised so TopBar doesn't re-render on every unrelated layout render —
    // this provider sits above the whole app.
    const value = useMemo(
        () => ({ docked, setDocked, homeViewDocked, setHomeViewDocked }),
        [docked, homeViewDocked],
    );
    return <SearchDockCtx.Provider value={value}>{children}</SearchDockCtx.Provider>;
}

export function useSearchDock(): DockValue {
    return useContext(SearchDockCtx);
}
