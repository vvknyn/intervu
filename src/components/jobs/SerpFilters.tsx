"use client";

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
    "1d": "Past 24h",
    "3d": "Past 3 days",
    "7d": "Past week",
    "30d": "Past month",
    older: "Older than 30 days",
};

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
    testId,
}: {
    active: boolean;
    onClick: () => void;
    count?: number;
    children: React.ReactNode;
    testId?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            data-testid={testId}
            className={cn(
                // min-h-11 (44px) rather than the old min-h-7 (28px) — every
                // row in the filters band (Date Posted, Work Type, Salary,
                // …) routes through this one Affordance, so the P27 mobile
                // tap-target fix lands class-wide from this single edit
                // instead of touching each FacetGroup/toggle separately.
                "flex min-h-11 w-full items-center gap-2 text-left text-[13px] font-medium transition-colors duration-100",
                active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
        >
            <span
                className={cn(
                    "grid h-3.5 w-3.5 shrink-0 place-items-center border-[1.5px] text-[10px] leading-none",
                    active ? "border-foreground bg-foreground text-background" : "border-border bg-card",
                )}
                aria-hidden
            >
                {active ? "✓" : null}
            </span>
            <span className="min-w-0 flex-1">{children}</span>
            {typeof count === "number" && (
                <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{count.toLocaleString()}</span>
            )}
        </button>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </div>
            <div className="flex flex-col gap-1.5">{children}</div>
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
    board,
    onBoardChange,
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
    postedDateSupported: boolean;
    board?: "all" | "elite";
    onBoardChange?: (b: "all" | "elite") => void;
}) {
    const ghostHideLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide likely ghosts (−${ghostHiddenCount.toLocaleString()})`
            : "Hide likely ghosts";

    return (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
            {postedDateSupported && (
                <Group label="Date posted">
                    {POSTED_BUCKET_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            active={state.postedBucket === o.value}
                            onClick={() => onPostedBucket(o.value)}
                        >
                            {o.value ? (DATE_POSTED_SHORT_LABELS[o.value] ?? o.label) : "Any date"}
                        </Affordance>
                    ))}
                </Group>
            )}

            <FacetGroup
                label="Work type"
                facetKey="work_type"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
            />

            <Group label="Salary">
                {SALARY_PRESETS.map((s) => (
                    <Affordance key={s.value} active={state.salaryMin === s.value} onClick={() => onSalaryMin(s.value)}>
                        {s.label}
                    </Affordance>
                ))}
            </Group>

            <FacetGroup
                label="Country"
                facetKey="location_country"
                distribution={distribution}
                state={state}
                onToggleFacet={onToggleFacet}
                cap={TOP_N}
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

            <Group label="Ghost risk">
                <Affordance active={hideGhosts} onClick={() => onHideGhosts(true)}>
                    {ghostHideLabel}
                </Affordance>
                <Affordance active={!hideGhosts} onClick={() => onHideGhosts(false)}>
                    Show all postings
                </Affordance>
                <Affordance active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)}>
                    Sponsors visas
                </Affordance>
            </Group>

            {onBoardChange && (
                <Group label="Boards">
                    <Affordance
                        testId="board-filter-elite"
                        active={board === "elite"}
                        onClick={() => onBoardChange("elite")}
                    >
                        Elite startups
                    </Affordance>
                    <Affordance testId="board-filter-all" active={board !== "elite"} onClick={() => onBoardChange("all")}>
                        All companies
                    </Affordance>
                </Group>
            )}

            {activeCount > 0 && (
                <Group label="Active">
                    <Affordance active onClick={onClearAll}>
                        Reset all ✕
                    </Affordance>
                </Group>
            )}
        </div>
    );
}
