"use client";

import { CaretDown } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { FacetDistribution, FacetKey, PostedBucket } from "@/lib/jobs/types";
import {
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
                className={cn(chipVariants({ active: activeValue != null }), "rounded-md")}
            >
                {activeValue ? `${label} · ${activeValue}` : label}
                <CaretDown size={11} weight="bold" aria-hidden className="opacity-60" />
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="flex w-60 flex-col gap-1 rounded-xl border border-slate-200 p-3 shadow-lg dark:border-slate-700"
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

    return (
        <div data-testid="facet-bar" className="hidden flex-wrap items-center gap-2 lg:flex">
            {postedDateSupported && (
                <FacetChip
                    label="Posted"
                    activeValue={state.postedBucket ? (DATE_POSTED_SHORT_LABELS[state.postedBucket] ?? state.postedBucket) : null}
                    testId="facet-chip-posted"
                >
                    {POSTED_BUCKET_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            inputType="radio"
                            active={state.postedBucket === o.value}
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
            {facetChip("Work mode", "work_type", "facet-chip-work-mode")}
            {facetChip("Experience", "experience_level", "facet-chip-experience")}
        </div>
    );
}
