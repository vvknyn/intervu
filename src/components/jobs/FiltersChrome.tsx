"use client";

import { useRef } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { filterCountBadgeClass } from "@/components/ui/chip";
import { Sheet, SheetBar, SheetBody, SheetClose, SheetContent, SheetFooter, SheetTitle } from "@/components/ui/sheet";
import { SubTitle } from "@/components/ui/heading";

/**
 * The two frames the one filter column (SerpFilters) is shown in.
 *
 * `FilterRail` is the laptop frame: a panel in the page beside the list, its
 * own scroll under the header, with the title, the count of what is applied
 * and Clear all always in view above the groups. `FiltersSheet` is the frame
 * for everything else: a bottom sheet on a phone, a left drawer on a laptop
 * with no list yet. Both carry the same `filters-panel` body so a journey
 * reads the groups the same way wherever they sit.
 */

export function FilterRail({
    activeCount,
    onClearAll,
    children,
}: {
    activeCount: number;
    onClearAll: () => void;
    children: React.ReactNode;
}) {
    return (
        <aside
            aria-label="Filters"
            data-testid="filters-rail"
            className="jobs-filter-rail self-start rounded-panel bg-surface"
        >
            {/* Pinned: the rail scrolls under it, so the count and Clear all stay in reach. */}
            <div className="poster-list-inset-x sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface pb-1 pt-3">
                <SubTitle className="flex items-center gap-2">
                    Filters
                    {activeCount > 0 && <span className={filterCountBadgeClass}>{activeCount}</span>}
                </SubTitle>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={onClearAll}
                    disabled={activeCount === 0}
                    data-testid="filters-clear-all"
                >
                    Clear all
                </Button>
            </div>
            <div id="filters-panel" data-testid="filters-panel" className="poster-list-inset-x pb-2 text-foreground">
                {children}
            </div>
        </aside>
    );
}

export function FiltersSheet({
    open,
    onOpenChange,
    side,
    activeCount,
    onClearAll,
    showLabel,
    onShow,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    side: "bottom" | "left";
    activeCount: number;
    onClearAll: () => void;
    /** "Show 1,284 jobs" — the live total, never a guess (showResultsLabel). */
    showLabel: string;
    onShow: () => void;
    children: React.ReactNode;
}) {
    // No trigger wraps the Filters button (it sits in the toolbar or the header), so Radix has nowhere
    // to send focus on close: remember what had it when the sheet opened and hand it back.
    const opener = useRef<HTMLElement | null>(null);
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={side}
                hideCloseButton
                onOpenAutoFocus={() => {
                    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (opener.current?.isConnected) opener.current.focus();
                }}
                className={
                    side === "bottom"
                        ? "mx-auto w-full max-w-2xl gap-0 border-border border-b-0 p-0"
                        : "w-full gap-0 border-border p-0 sm:max-w-sm"
                }
            >
                {side === "bottom" ? (
                    <SheetBar title="Filters" />
                ) : (
                    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                        <SheetTitle className="min-w-0 flex-1 text-base">Filters</SheetTitle>
                        <SheetClose
                            aria-label="Close"
                            className="ctl-md ctl-button flex ctl-square shrink-0 items-center justify-center text-faint transition-opacity hover:opacity-80"
                        >
                            <X size={16} aria-hidden />
                        </SheetClose>
                    </div>
                )}
                <SheetBody id="filters-panel" data-testid="filters-panel" className="poster-list-inset-x py-2 text-foreground custom-scrollbar">
                    {children}
                </SheetBody>
                {/* Filters apply live, so "Show N jobs" only closes the sheet. */}
                <SheetFooter className="shrink-0 flex-row gap-3 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <Button variant="outline" size="touch" disabled={activeCount === 0} onClick={onClearAll}>
                        Clear all
                    </Button>
                    <Button size="touch" className="flex-1" onClick={onShow}>
                        {showLabel}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
