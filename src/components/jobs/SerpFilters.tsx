"use client";

import type { FacetDistribution, FacetKey, PostedBucket } from "@/lib/jobs/types";
import {
    facetValueLabel,
    isNoiseFacetValue,
    POSTED_BUCKET_PRESETS,
    SALARY_PRESETS,
    STATIC_FACET_LADDERS,
    TOP_N,
    distributionTaggedShare,
    booleanTaggedShare,
    type FilterState,
} from "@/components/jobs/FilterPanel";

export const DATE_POSTED_SHORT_LABELS: Partial<Record<PostedBucket, string>> = {
    "1d": "Past 24h",
    "3d": "Past 3 days",
    "7d": "Past week",
    "30d": "Past month",
    older: "Older than 30 days",
};

export function facetOptions(
    distribution: FacetDistribution | undefined,
    selected: string[],
    key: FacetKey,
    cap?: number,
    staticLadder?: readonly string[],
): [string, number][] {
    const dist = distribution?.[key];
    const merged = new Map<string, number>(dist ? Object.entries(dist) : []);
    for (const v of staticLadder ?? []) if (!merged.has(v)) merged.set(v, 0);
    for (const v of selected) if (!merged.has(v)) merged.set(v, 0);
    const all = [...merged.entries()]
        .filter(([v]) => selected.includes(v) || !isNoiseFacetValue(key, v))
        .sort((a, b) => b[1] - a[1]);
    return cap ? all.slice(0, cap) : all;
}

export function Affordance({
    active,
    onClick,
    count,
    children,
    testId,
    inputType = "checkbox",
}: {
    active: boolean;
    onClick: () => void;
    count?: number;
    children: React.ReactNode;
    testId?: string;
    inputType?: "checkbox" | "radio";
}) {
    return (
        <label
            data-testid={testId}
            className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-foreground"
        >
            <input
                type={inputType}
                checked={active}
                readOnly
                onClick={onClick}
                className="h-3.5 w-3.5 shrink-0 accent-foreground"
            />
            <span className="min-w-0 flex-1">{children}</span>
            {typeof count === "number" && (
                <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{count.toLocaleString()}</span>
            )}
        </label>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col">
            <h4 className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                {label}
            </h4>
            <div className="flex flex-col gap-2">{children}</div>
        </div>
    );
}

function FacetGroup({
    label,
    facetKey,
    distribution,
    state,
    onToggleFacet,
    cap,
    caption,
}: {
    label: string;
    facetKey: FacetKey;
    distribution: FacetDistribution | undefined;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
    caption?: string;
}) {
    const selected = state.facets[facetKey] ?? [];
    const options = facetOptions(distribution, selected, facetKey, cap, STATIC_FACET_LADDERS[facetKey]);
    if (options.length === 0) return null;
    return (
        <Group label={label}>
            {options.map(([value, n]) => (
                <Affordance
                    key={value}
                    active={selected.includes(value)}
                    count={n > 0 ? n : undefined}
                    onClick={() => onToggleFacet(facetKey, value)}
                >
                    {facetValueLabel(facetKey, value)}
                </Affordance>
            ))}
            {caption && <p className="mt-1 font-mono text-[10px] text-faint">{caption}</p>}
        </Group>
    );
}

export function SerpFilters({
    distribution,
    resultTotal,
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
    board,
    onBoardChange,
}: {
    distribution: FacetDistribution | undefined;
    resultTotal?: number;
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
    postedDateSupported: boolean;
    board?: "all" | "elite";
    onBoardChange?: (b: "all" | "elite") => void;
}) {
    const ghostHideLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide likely ghosts (−${ghostHiddenCount.toLocaleString()})`
            : "Hide likely ghosts";
    const workShare = distributionTaggedShare(distribution?.work_type);
    const visaShare = booleanTaggedShare(distribution?.visa_sponsorship, resultTotal ?? 0);

    return (
        <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
                {postedDateSupported && (
                    <Group label="Date posted">
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
                    </Group>
                )}

                <Group label="Salary">
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
                </Group>

                <FacetGroup
                    label="Work mode"
                    facetKey="work_type"
                    distribution={distribution}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    caption={workShare != null ? `work mode is tagged on ~${Math.round(workShare * 100)}% of roles` : undefined}
                />

                <FacetGroup
                    label="Experience"
                    facetKey="experience_level"
                    distribution={distribution}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <FacetGroup
                    label="Employment"
                    facetKey="employment_type"
                    distribution={distribution}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <FacetGroup
                    label="Country"
                    facetKey="location_country"
                    distribution={distribution}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <Group label="Ghost risk">
                    <Affordance inputType="radio" active={hideGhosts} onClick={() => onHideGhosts(true)}>
                        {ghostHideLabel}
                    </Affordance>
                    <Affordance inputType="radio" active={!hideGhosts} onClick={() => onHideGhosts(false)}>
                        Show all postings
                    </Affordance>
                </Group>

                {onBoardChange && (
                    <Group label="Boards">
                        <Affordance
                            testId="board-filter-elite"
                            inputType="radio"
                            active={board === "elite"}
                            onClick={() => onBoardChange("elite")}
                        >
                            Elite startups
                        </Affordance>
                        <Affordance
                            testId="board-filter-all"
                            inputType="radio"
                            active={board !== "elite"}
                            onClick={() => onBoardChange("all")}
                        >
                            All companies
                        </Affordance>
                    </Group>
                )}
            </div>

            <div className="mt-4 flex flex-wrap items-start gap-x-5 gap-y-3 border-t border-border pt-3.5">
                <div className="flex flex-col gap-1">
                    <Affordance active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)}>
                        Sponsors visas
                    </Affordance>
                    {visaShare != null && (
                        <p className="pl-5 font-mono text-[10px] text-faint">
                            sponsorship info exists on ~{Math.round(visaShare * 100)}% of roles
                        </p>
                    )}
                </div>
                {activeCount > 0 && (
                    <Affordance active onClick={onClearAll}>
                        Reset all ✕
                    </Affordance>
                )}
            </div>
        </>
    );
}
