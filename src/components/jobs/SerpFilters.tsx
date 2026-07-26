"use client";

/**
 * Editorial filter band for the jobs SERP — replaces the portal-pass
 * FilterPanel card (rounded border, checkboxes, collapsible sections) with
 * plain-text affordances that match the page's own grammar (hairline rules,
 * font-mono text-xs, underline = active). The decision helpers (toggle,
 * active-state, labels, noise filtering) stay in FilterPanel.tsx — this file
 * only renders them differently, so there isn't a second copy of the rules.
 */

import { cn } from "@/lib/utils";
import type { FacetDistribution, FacetKey, PostedBucket } from "@/lib/jobs/types";
import {
    facetValueLabel,
    isNoiseFacetValue,
    POSTED_BUCKET_PRESETS,
    SALARY_PRESETS,
    TOP_N,
    type FilterState,
} from "@/components/jobs/FilterPanel";

const DATE_POSTED_SHORT_LABELS: Partial<Record<PostedBucket, string>> = {
    "1d": "24h",
    "3d": "3d",
    "7d": "7d",
    "30d": "30d",
    older: "older",
};

/** value→count options for one facet group: selected-but-zero values stay
 *  visible (so they remain clickable-off), noise is dropped, sorted by
 *  count desc, optionally capped to the top N. Mirrors the logic the old
 *  FilterPanel card used internally, kept here since this is now the only
 *  renderer of facet groups. */
function facetOptions(
    distribution: FacetDistribution | undefined,
    selected: string[],
    key: FacetKey,
    cap?: number,
): [string, number][] {
    const dist = distribution?.[key];
    const merged = new Map<string, number>(dist ? Object.entries(dist) : []);
    for (const v of selected) if (!merged.has(v)) merged.set(v, 0);
    const all = [...merged.entries()]
        .filter(([v]) => selected.includes(v) || !isNoiseFacetValue(key, v))
        .sort((a, b) => b[1] - a[1]);
    return cap ? all.slice(0, cap) : all;
}

function Affordance({
    active,
    onClick,
    count,
    children,
}: {
    active: boolean;
    onClick: () => void;
    count?: number;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "font-mono text-xs transition-colors duration-100",
                active ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground",
            )}
        >
            {children}
            {typeof count === "number" && <span className="text-faint"> {count.toLocaleString()}</span>}
        </button>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">{children}</div>
        </div>
    );
}

/** One facet group (work type / country / experience / employment): renders
 *  nothing when there are no values to show. */
function FacetGroup({
    label,
    facetKey,
    distribution,
    state,
    onToggleFacet,
    cap,
}: {
    label: string;
    facetKey: FacetKey;
    distribution: FacetDistribution | undefined;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
}) {
    const selected = state.facets[facetKey] ?? [];
    const options = facetOptions(distribution, selected, facetKey, cap);
    if (options.length === 0) return null;
    return (
        <Group label={label}>
            {options.map(([value, n]) => (
                <Affordance
                    key={value}
                    active={selected.includes(value)}
                    count={n}
                    onClick={() => onToggleFacet(facetKey, value)}
                >
                    {facetValueLabel(facetKey, value)}
                </Affordance>
            ))}
        </Group>
    );
}

export function SerpFilters({
    distribution,
    state,
    activeCount,
    onToggleFacet,
    onSalaryMin,
    onVisaOnly,
    onPostedBucket,
    onClearAll,
    hideGhosts,
    onHideGhosts,
    ghostHiddenCount,
    postedDateSupported,
}: {
    distribution: FacetDistribution | undefined;
    state: FilterState;
    activeCount: number;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    onVisaOnly: (v: boolean) => void;
    onPostedBucket: (v: PostedBucket | undefined) => void;
    onClearAll: () => void;
    hideGhosts: boolean;
    onHideGhosts: (v: boolean) => void;
    ghostHiddenCount: number | null;
    /** False when the corpus carries no `posted_ts` — the age buckets are hidden rather than offered dead. */
    postedDateSupported: boolean;
}) {
    const ghostLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `hide likely-ghost (−${ghostHiddenCount.toLocaleString()})`
            : "hide likely-ghost";

    return (
        <div className="flex flex-wrap gap-x-10 gap-y-4">
            {postedDateSupported && (
                <Group label="date posted">
                    {POSTED_BUCKET_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            active={state.postedBucket === o.value}
                            onClick={() => onPostedBucket(o.value)}
                        >
                            {o.value ? (DATE_POSTED_SHORT_LABELS[o.value] ?? o.value) : "any"}
                        </Affordance>
                    ))}
                </Group>
            )}

            <FacetGroup
                label="work type"
                facetKey="work_type"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
            />

            <Group label="salary">
                {SALARY_PRESETS.map((s) => (
                    <Affordance key={s.value} active={state.salaryMin === s.value} onClick={() => onSalaryMin(s.value)}>
                        {s.label.toLowerCase()}
                    </Affordance>
                ))}
            </Group>

            <FacetGroup
                label="country"
                facetKey="location_country"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
                cap={TOP_N}
            />

            <FacetGroup
                label="experience"
                facetKey="experience_level"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
                cap={TOP_N}
            />

            <FacetGroup
                label="employment"
                facetKey="employment_type"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
                cap={TOP_N}
            />

            <Group label="posting health">
                <Affordance active={hideGhosts} onClick={() => onHideGhosts(!hideGhosts)}>
                    {ghostLabel}
                </Affordance>
                <Affordance active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)}>
                    sponsors visas
                </Affordance>
            </Group>

            {activeCount > 0 && (
                <Group label="active">
                    <Affordance active onClick={onClearAll}>
                        reset all ✕
                    </Affordance>
                </Group>
            )}
        </div>
    );
}
