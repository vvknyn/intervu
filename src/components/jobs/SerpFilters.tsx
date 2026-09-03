"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FacetDistribution, FacetKey, PostedBucket, YearsExperienceBucket } from "@/lib/jobs/types";
import {
    appliedPostedBucket,
    facetKeyLabel,
    facetValueLabel,
    facetGroupVisible,
    isNoiseFacetValue,
    POSTED_BUCKET_PRESETS,
    SALARY_PRESETS,
    STATIC_FACET_LADDERS,
    TOP_N,
    YEARS_EXPERIENCE_PRESETS,
    distributionTaggedShare,
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
            className={cn(
                "flex min-h-8 cursor-pointer items-center gap-2 text-xs leading-tight text-foreground",
                active && inputType === "radio" && "text-brand",
            )}
        >
            <input
                type={inputType}
                checked={active}
                readOnly
                onClick={onClick}
                className="h-3.5 w-3.5 shrink-0 accent-brand"
            />
            <span className="min-w-0 flex-1">{children}</span>
            {typeof count === "number" && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
            )}
        </label>
    );
}

function Group({
    label,
    count,
    children,
}: {
    label: string;
    /** Quiet count of active selections in this group — shown next to the
     *  heading so a collapsed/scrolled panel still signals which groups
     *  carry selections (Task #48, Part B item 3). Omit or pass 0 for
     *  groups where "count" isn't a meaningful concept (single-select
     *  radios already name their one active choice inline). */
    count?: number;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col">
            <h4 className="mb-1 flex items-baseline gap-1 whitespace-nowrap text-xs font-semibold text-muted-foreground">
                {label}
                {typeof count === "number" && count > 0 && (
                    <span className="font-normal normal-case tabular-nums text-brand">({count})</span>
                )}
            </h4>
            <div className="flex flex-col gap-1">{children}</div>
        </div>
    );
}

function FacetGroup({
    label,
    facetKey,
    distribution,
    resultTotal,
    state,
    onToggleFacet,
    cap,
    caption,
}: {
    label: string;
    facetKey: FacetKey;
    distribution: FacetDistribution | undefined;
    resultTotal: number;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
    caption?: string;
}) {
    const selected = state.facets[facetKey] ?? [];
    const options = facetOptions(distribution, selected, facetKey, cap, STATIC_FACET_LADDERS[facetKey]);
    if (!facetGroupVisible(distribution?.[facetKey], resultTotal, options)) return null;
    return (
        <Group label={label} count={selected.length}>
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
            {caption && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{caption}</p>}
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
    onYearsExperience,
    onClearAll,
    hideGhosts,
    onHideGhosts,
    ghostHiddenCount,
    hideViewed,
    onHideViewed,
    postedDateSupported,
    board,
    onBoardChange,
    layout = "panel",
}: {
    distribution: FacetDistribution | undefined;
    resultTotal?: number;
    state: FilterState;
    activeCount: number;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    onVisaOnly: (v: boolean) => void;
    onPostedBucket: (v: PostedBucket | undefined) => void;
    onYearsExperience: (v: YearsExperienceBucket | undefined) => void;
    onClearAll: () => void;
    hideGhosts: boolean;
    onHideGhosts: (v: boolean) => void;
    ghostHiddenCount: number | null;
    hideViewed: boolean;
    onHideViewed: (v: boolean) => void;
    postedDateSupported: boolean;
    board?: "all" | "elite";
    onBoardChange?: (b: "all" | "elite") => void;
    /**
     * How much horizontal room the caller is giving us.
     *
     * `panel` (default) is the full-width expand and the bottom sheet — the
     * groups sit side by side. `rail` is the dense layout's 232px column, where
     * they must stack.
     *
     * This is a PROP and not a breakpoint because Tailwind's `md:` asks the
     * VIEWPORT how wide it is, not this element. In the dense rail those two
     * answers disagree completely: a 1512px window happily applies
     * `md:grid-cols-4` to a 232px box and packs four columns of radio labels
     * into ~50px each, which overlaps them into an unreadable stack. Only the
     * caller knows which box the filters landed in.
     */
    layout?: "panel" | "rail";
}) {
    const ghostHideLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide possibly stale (−${ghostHiddenCount.toLocaleString()})`
            : "Hide possibly stale";
    const workShare = distributionTaggedShare(distribution?.work_type, resultTotal ?? 0);
    const visaShare = distributionTaggedShare(distribution?.visa_sponsorship, resultTotal ?? 0);

    return (
        <>
            <div
                className={
                    layout === "rail"
                        ? "grid grid-cols-1 gap-y-3"
                        : "grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4"
                }
            >
                {postedDateSupported && (
                    <Group label="Date posted">
                        {POSTED_BUCKET_PRESETS.map((o) => (
                            <Affordance
                                key={o.label}
                                inputType="radio"
                                active={appliedPostedBucket(state) === o.value}
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
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    caption={workShare != null ? `work mode is tagged on ~${Math.round(workShare * 100)}% of roles` : undefined}
                />

                <FacetGroup
                    label="Experience"
                    facetKey="experience_level"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <FacetGroup
                    label="Employment"
                    facetKey="employment_type"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <Group label="Visa">
                    <Affordance active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)}>
                        Sponsors visas
                    </Affordance>
                    {visaShare != null && (
                        <p className="pl-[22px] text-xs leading-snug text-muted-foreground">
                            sponsorship info exists on ~{Math.round(visaShare * 100)}% of roles
                        </p>
                    )}
                </Group>

                <FacetGroup
                    label="Country"
                    facetKey="location_country"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <FacetGroup
                    label={facetKeyLabel("tech_stack")}
                    facetKey="tech_stack"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <FacetGroup
                    label="Must-have skills"
                    facetKey="must_have_skills"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                />

                <Group label="Years of experience">
                    {YEARS_EXPERIENCE_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            inputType="radio"
                            active={state.yearsExperience === o.value}
                            onClick={() => onYearsExperience(o.value)}
                        >
                            {o.label}
                        </Affordance>
                    ))}
                </Group>

                <Group label="Posting check">
                    <Affordance inputType="radio" active={hideGhosts} onClick={() => onHideGhosts(true)}>
                        {ghostHideLabel}
                    </Affordance>
                    <Affordance inputType="radio" active={!hideGhosts} onClick={() => onHideGhosts(false)}>
                        Show all postings
                    </Affordance>
                </Group>

                <Group label="Viewed">
                    <Affordance inputType="radio" active={!hideViewed} onClick={() => onHideViewed(false)}>
                        Show all
                    </Affordance>
                    <Affordance inputType="radio" active={hideViewed} onClick={() => onHideViewed(true)}>
                        Hide already viewed
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

            {activeCount > 0 && (
                <div className="mt-2 flex justify-end border-t border-border pt-2">
                    <Button variant="ghost" size="xs" onClick={onClearAll}>
                        Reset all ✕
                    </Button>
                </div>
            )}
        </>
    );
}
