"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

/**
 * What the header shows once a page's own search has scrolled out of reach.
 *
 * The seam is deliberately narrow: the header does NOT know what a job search
 * is, what Meili is, or which page published this. It renders a label, an
 * optional place, and a way back. Any page that owns a search can dock into
 * the same slot without TopBar growing a second code path.
 *
 * `null` means nothing is docked and the header keeps its normal layout.
 */
export type DockedSearch = {
    /** What was searched for. Falls back to a generic label when the box is empty. */
    label: string;
    /** Where, when a location is actually set. Omitted rather than shown empty. */
    place?: string;
    /** Puts the real search back in front of the person and focuses it. */
    onExpand: () => void;
} | null;

type DockValue = {
    docked: DockedSearch;
    setDocked: (next: DockedSearch) => void;
};

const SearchDockCtx = createContext<DockValue>({ docked: null, setDocked: () => {} });

export function SearchDockProvider({ children }: { children: React.ReactNode }) {
    const [docked, setDocked] = useState<DockedSearch>(null);
    // Memoised so TopBar doesn't re-render on every unrelated layout render —
    // this provider sits above the whole app.
    const value = useMemo(() => ({ docked, setDocked }), [docked]);
    return <SearchDockCtx.Provider value={value}>{children}</SearchDockCtx.Provider>;
}

export function useSearchDock(): DockValue {
    return useContext(SearchDockCtx);
}
