"use client";

import { Fragment } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipVariants } from "@/components/ui/chip";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { cn } from "@/lib/utils";
import type { FacetDistribution, FacetKey, PostedBucket } from "@/lib/jobs/types";
import {
    appliedPostedBucket,
    facetValueLabel,
    POSTED_BUCKET_PRESETS,
    SALARY_PRESETS,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import {
    Affordance,
    DATE_POSTED_SHORT_LABELS,
    facetOptions,
} from "@/components/jobs/SerpFilters";

/**
 * Visible facet bar (4dayweek-reference polish, 2026-08-14) — the standard
 * job-board faceted-navigation row: each high-traffic filter is its own
 * labeled dropdown chip instead of living only behind the single "Filters"
 * expand. This is a PRESENTATION of the existing filter system, not a
 * second one: options come from the same exported presets/`facetOptions`
 * SerpFilters renders, and every change routes through the same callbacks
 * the full panel uses (`onToggleFacet`/`onSalaryMin`/`onPostedBucket`), so
 * the bar, the panel, and the URL can never disagree. The full panel stays
 * as "All filters" for everything long-tail.
 */

/**
 * The facets this bar gives a searcher a named, one-click control for.
 * Drives the rendering below AND `facetBarRepresents` — one list, so the
 * "what does the bar already show" answer cannot drift from what it renders
 * the moment a chip is added or removed here.
 *
 * Why anything needs that answer: the toolbar's per-filter chip row was
 * removed 2026-08-15 as "duplicate information", on the premise that this
 * bar already lets a searcher see and drop each active filter one at a time.
 * That premise holds only for the concerns listed here — `location_country`
 * (set from the location box, never a chip), `employment_type`,
 * `visa_sponsorship` and `source` have no control on this bar, so when one
 * is active the toolbar showed a bare count naming nothing. `page.tsx` names
 * exactly the leftovers rather than restoring the whole duplicated row.
 */
export const FACET_BAR_FACETS: readonly { label: string; key: FacetKey; testId: string }[] = [
    { label: "Work mode", key: "work_type", testId: "facet-chip-work-mode" },
    { label: "Experience", key: "experience_level", testId: "facet-chip-experience" },
];

/**
 * Heads of the `activeFilterEntries` keys this bar controls — facet keys
 * plus the non-facet concerns it owns. `postedDateSupported` is a prop, not
 * a constant: when the backend can't sort/filter by date the Posted chip
 * isn't rendered, so on that path the bar genuinely doesn't represent it.
 */
export function facetBarRepresents(postedDateSupported: boolean): ReadonlySet<string> {
    return new Set<string>([
        ...FACET_BAR_FACETS.map((f) => f.key),
        "salaryMin",
        ...(postedDateSupported ? ["postedBucket"] : []),
    ]);
}

/** One dropdown chip. `activeValue` doubles as the active-state signal and
 *  the chip's value suffix ("Posted · Past week"). */
function FacetChip({
    label,
    activeValue,
    testId,
    children,
}: {
    label: string;
    activeValue: string | null;
    testId: string;
    children: React.ReactNode;
}) {
    return (
        <Popover>
            <PopoverTrigger
                data-testid={testId}
                className={cn(
                    chipVariants({ active: activeValue != null }),
                    toolbarControlHeight,
                    "inline-flex box-border items-center justify-center leading-none rounded-none px-3 lg:px-2",
                )}
            >
                {activeValue ? `${label} · ${activeValue}` : label}
                <CaretDown size={16} weight="bold" aria-hidden className="opacity-60" />
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="flex w-56 flex-col gap-0.5 rounded-none border border-border bg-card p-2"
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}

/** Chip value suffix for a multi-select facet: the value itself when one is
 *  picked, a count when several are. */
function facetActiveValue(key: FacetKey, selected: string[]): string | null {
    if (selected.length === 0) return null;
    if (selected.length === 1) return facetValueLabel(key, selected[0]!);
    return `${selected.length}`;
}

export function FacetBar({
    distribution,
    state,
    postedDateSupported,
    onToggleFacet,
    onSalaryMin,
    onPostedBucket,
}: {
    distribution: FacetDistribution | undefined;
    state: FilterState;
    postedDateSupported: boolean;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    onPostedBucket: (v: PostedBucket | undefined) => void;
}) {
    const facetChip = (label: string, key: FacetKey, testId: string) => {
        const selected = state.facets[key] ?? [];
        const options = facetOptions(distribution, selected, key, 6);
        if (options.length === 0) return null;
        return (
            <FacetChip label={label} activeValue={facetActiveValue(key, selected)} testId={testId}>
                {options.map(([value, n]) => (
                    <Affordance
                        key={value}
                        active={selected.includes(value)}
                        count={n > 0 ? n : undefined}
                        onClick={() => onToggleFacet(key, value)}
                    >
                        {facetValueLabel(key, value)}
                    </Affordance>
                ))}
            </FacetChip>
        );
    };

    // Never the raw bucket: the fresh-visit 30d is a default nobody chose and
    // nothing filtered on, so the chip must read "Posted" and "Any date" must
    // be the checked option until the searcher picks a window.
    const posted = appliedPostedBucket(state);

    return (
        <div data-testid="facet-bar" className="hidden flex-wrap items-center gap-2 lg:flex">
            {postedDateSupported && (
                <FacetChip
                    label="Posted"
                    activeValue={posted ? (DATE_POSTED_SHORT_LABELS[posted] ?? posted) : null}
                    testId="facet-chip-posted"
                >
                    {POSTED_BUCKET_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            inputType="radio"
                            active={posted === o.value}
                            onClick={() => onPostedBucket(o.value)}
                        >
                            {o.value ? (DATE_POSTED_SHORT_LABELS[o.value] ?? o.label) : "Any date"}
                        </Affordance>
                    ))}
                </FacetChip>
            )}
            <FacetChip
                label="Salary"
                activeValue={
                    state.salaryMin > 0
                        ? (SALARY_PRESETS.find((s) => s.value === state.salaryMin)?.label ?? null)
                        : null
                }
                testId="facet-chip-salary"
            >
                {SALARY_PRESETS.map((s) => (
                    <Affordance
                        key={s.value}
                        inputType="radio"
                        active={state.salaryMin === s.value}
                        onClick={() => onSalaryMin(s.value)}
                    >
                        {s.label}
                    </Affordance>
                ))}
            </FacetChip>
            {FACET_BAR_FACETS.map((f) => (
                <Fragment key={f.key}>{facetChip(f.label, f.key, f.testId)}</Fragment>
            ))}
        </div>
    );
}
