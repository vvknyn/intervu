"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FacetDistribution, FacetKey, PanelFacetKey, PostedBucket, YearsExperienceBucket } from "@/lib/jobs/types";
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
    "90d": "Past 3 months",
    older: "Older than 90 days",
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
    variant = "row",
}: {
    active: boolean;
    onClick: () => void;
    count?: number;
    children: React.ReactNode;
    testId?: string;
    inputType?: "checkbox" | "radio";
    variant?: "row" | "chip";
}) {
    if (variant === "chip") {
        return (
            <label
                data-testid={testId}
                className={cn(
                    "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-ctl border px-2.5 py-1 text-xs leading-tight whitespace-nowrap transition-colors",
                    active
                        ? "border-brand bg-live-tint-bg font-semibold text-brand"
                        : "border-border bg-background text-foreground hover:bg-muted",
                )}
            >
                <input
                    type={inputType}
                    checked={active}
                    readOnly
                    onClick={onClick}
                    // control-scale-allow: checkbox/radio glyph (dynamic `type`), not a scale control
                    className="h-3.5 w-3.5 shrink-0 accent-brand"
                />
                <span>{children}</span>
                {typeof count === "number" && (
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {count.toLocaleString()}
                    </span>
                )}
            </label>
        );
    }

    return (
        <label
            data-testid={testId}
            className={cn(
                "flex min-h-8 cursor-pointer items-center gap-2 rounded-ctl px-1.5 text-xs leading-tight text-foreground transition-colors hover:bg-muted",
                active && inputType === "radio" && "font-semibold text-live",
            )}
        >
            <input
                type={inputType}
                checked={active}
                readOnly
                onClick={onClick}
                // control-scale-allow: checkbox/radio glyph (dynamic `type`), not a scale control
                className="h-3.5 w-3.5 shrink-0 accent-brand"
            />
            <span className="min-w-0 flex-1">{children}</span>
            {typeof count === "number" && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
            )}
        </label>
    );
}

/** The typed draft as a salary floor in whole dollars, or `null` when it is not
 *  a number we can read without guessing. Accepts "120000", "$120,000",
 *  "120,000", "120k"/"120K", "120.5k" and "120000.50" (rounded to the dollar);
 *  blank is 0, which clears the floor. Everything else ("1.5e5", "-5", "abc",
 *  "12 0", "120k+") is `null`: stripping non-digits turned "120k" into 120,
 *  "1.5e5" into 155 and "120000.50" into 12000050, each a silent wrong filter. */
export function parseSalaryMinDraft(draft: string): number | null {
    const text = draft.trim().replace(/^\$\s*(?=\S)/, "");
    if (text === "") return 0;
    const m = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([kK])?$/.exec(text);
    if (!m) return null;
    const amount = Number(m[1].replace(/,/g, "") + (m[2] ?? "")) * (m[3] ? 1000 : 1);
    return Number.isSafeInteger(Math.round(amount)) ? Math.round(amount) : null;
}

/**
 * Free-form salary floor, alongside the SALARY_PRESETS ladder (G1) — writes
 * the exact same `salary_min` param the preset radios do, so there is one
 * filter, not a second one layered on top. No max: the product only ever
 * filters on a floor. Local draft state so typing doesn't fight the
 * controlled `salaryMin` prop on every keystroke; commits on blur/Enter,
 * and stays in sync when a preset click changes `salaryMin` externally.
 * Exported so both SerpFilters' own Salary group and FacetBar's Salary chip
 * (a presentation of this same filter, not a second one) mount it.
 */
/** Error copy shows only what the digit keypad (inputMode="numeric") can type;
 *  the parser still accepts "120k" / "$120,000" from a desktop keyboard or paste. */
export const SALARY_MIN_ERROR = "Enter an amount like 120000.";

export function SalaryCustomMinInput({
    salaryMin,
    onSalaryMin,
}: {
    salaryMin: number;
    onSalaryMin: (v: number) => void;
}) {
    const [draft, setDraft] = useState(salaryMin > 0 ? String(salaryMin) : "");
    const [invalid, setInvalid] = useState(false);

    useEffect(() => {
        setDraft(salaryMin > 0 ? String(salaryMin) : "");
        setInvalid(false);
    }, [salaryMin]);

    const commit = () => {
        const value = parseSalaryMinDraft(draft);
        setInvalid(value === null);
        if (value !== null) onSalaryMin(value);
    };

    return (
        // Wraps the field under its label when the column is narrow (a
        // 320px phone cut the placeholder to "$ e.g."); the field takes the
        // control corner like every other input (2026-10-02).
        <label className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-foreground">
            <span className="shrink-0 text-muted-foreground">Custom minimum</span>
            <span className="flex min-w-0 items-center gap-1 rounded-ctl border border-border px-1.5 py-1">
                <span className="text-muted-foreground">$</span>
                <input
                    type="text"
                    inputMode="numeric"
                    enterKeyHint="done"
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setInvalid(false);
                    }}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        commit();
                    }}
                    placeholder="e.g. 65000"
                    aria-label="Custom minimum salary"
                    aria-invalid={invalid || undefined}
                    data-testid="salary-custom-min"
                    className="w-20 min-w-0 bg-transparent text-xs text-foreground outline-none"
                />
            </span>
            {invalid && (
                <span role="alert" className="w-full text-destructive" data-testid="salary-custom-min-error">
                    {SALARY_MIN_ERROR}
                </span>
            )}
        </label>
    );
}

function Group({
    label,
    count,
    caption,
    headerRight,
    variant = "stack",
    children,
}: {
    label: string;
    /** Quiet count of active selections in this group — shown next to the
     *  heading so a collapsed/scrolled panel still signals which groups
     *  carry selections (Task #48, Part B item 3). Omit or pass 0 for
     *  groups where "count" isn't a meaningful concept (single-select
     *  radios already name their one active choice inline). */
    count?: number;
    caption?: string;
    headerRight?: React.ReactNode;
    variant?: "stack" | "chips";
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-baseline gap-1.5 whitespace-nowrap text-xs font-semibold text-foreground">
                    {label}
                    {typeof count === "number" && count > 0 && (
                        <span className="font-normal normal-case tabular-nums text-live">({count})</span>
                    )}
                    {caption && (
                        <span className="font-normal text-muted-foreground">· {caption}</span>
                    )}
                </h4>
                {headerRight}
            </div>
            <div className={variant === "chips" ? "flex flex-wrap gap-1.5" : "flex flex-col gap-0.5"}>
                {children}
            </div>
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
    variant = "stack",
}: {
    label: string;
    /** Typed off PANEL_FACET_KEYS (jobs/types.ts) — the same set MCP's
     *  search_jobs `facets` input accepts — so a generic picker for a key
     *  outside it is a typecheck error, not a silent drift between surfaces. */
    facetKey: PanelFacetKey;
    distribution: FacetDistribution | undefined;
    resultTotal: number;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
    caption?: string;
    variant?: "stack" | "chips";
}) {
    const selected = state.facets[facetKey] ?? [];
    const options = facetOptions(distribution, selected, facetKey, cap, STATIC_FACET_LADDERS[facetKey]);
    if (!facetGroupVisible(distribution?.[facetKey], resultTotal, options)) return null;
    return (
        <Group label={label} count={selected.length} caption={caption} variant={variant}>
            {options.map(([value, n]) => (
                <Affordance
                    key={value}
                    variant={variant === "chips" ? "chip" : "row"}
                    active={selected.includes(value)}
                    count={n > 0 ? n : undefined}
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
     * `panel` (default) is the desktop modal dialog; `sheet` is the mobile bottom sheet.
     * Both share a sticky modal footer with "Clear all" + "Show N roles".
     * `rail` is a narrow 232px column where groups stack vertically.
     */
    layout?: "panel" | "sheet" | "rail";
}) {
    const ghostHideLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide possibly stale (−${ghostHiddenCount.toLocaleString()})`
            : "Hide possibly stale";
    const workShare = distributionTaggedShare(distribution?.work_type, resultTotal ?? 0);
    const visaShare = distributionTaggedShare(distribution?.visa_sponsorship, resultTotal ?? 0);
    const isRail = layout === "rail";
    const choiceVariant = isRail ? "stack" : "chips";
    const itemVariant = isRail ? "row" : "chip";

    if (isRail) {
        return (
            <>
                <div className="grid grid-cols-1 gap-y-3">
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
                        <SalaryCustomMinInput salaryMin={state.salaryMin} onSalaryMin={onSalaryMin} />
                    </Group>
                    <FacetGroup
                        label="Work mode"
                        facetKey="work_type"
                        distribution={distribution}
                        resultTotal={resultTotal ?? 0}
                        state={state}
                        onToggleFacet={onToggleFacet}
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

    return (
        <div className="flex flex-col divide-y divide-border">
            {/* Tier 1: Primary quick-select pill bars (Date posted & Salary) */}
            <div className="flex flex-col gap-4 pb-4">
                {postedDateSupported && (
                    <Group label="Date posted" variant={choiceVariant}>
                        {POSTED_BUCKET_PRESETS.map((o) => (
                            <Affordance
                                key={o.label}
                                variant={itemVariant}
                                inputType="radio"
                                active={appliedPostedBucket(state) === o.value}
                                onClick={() => onPostedBucket(o.value)}
                            >
                                {o.value ? (DATE_POSTED_SHORT_LABELS[o.value] ?? o.label) : "Any date"}
                            </Affordance>
                        ))}
                    </Group>
                )}

                <Group
                    label="Minimum salary"
                    variant={choiceVariant}
                    headerRight={<SalaryCustomMinInput salaryMin={state.salaryMin} onSalaryMin={onSalaryMin} />}
                >
                    {SALARY_PRESETS.map((s) => (
                        <Affordance
                            key={s.value}
                            variant={itemVariant}
                            inputType="radio"
                            active={state.salaryMin === s.value}
                            onClick={() => onSalaryMin(s.value)}
                        >
                            {s.label}
                        </Affordance>
                    ))}
                </Group>
            </div>

            {/* Tier 2: Role attributes in a balanced 2x2 grid */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 py-4 sm:grid-cols-2">
                <FacetGroup
                    label="Work mode"
                    facetKey="work_type"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    variant={choiceVariant}
                    caption={workShare != null ? `~${Math.round(workShare * 100)}% tagged` : undefined}
                />

                <Group label="Years of experience" variant={choiceVariant}>
                    {YEARS_EXPERIENCE_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            variant={itemVariant}
                            inputType="radio"
                            active={state.yearsExperience === o.value}
                            onClick={() => onYearsExperience(o.value)}
                        >
                            {o.label}
                        </Affordance>
                    ))}
                </Group>

                <FacetGroup
                    label="Experience level"
                    facetKey="experience_level"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                    variant={choiceVariant}
                />

                <FacetGroup
                    label="Employment type"
                    facetKey="employment_type"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    cap={TOP_N}
                    variant={choiceVariant}
                />
            </div>

            {/* Tier 3: High-cardinality corpus facets with aligned tabular counts */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 py-4 sm:grid-cols-3">
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
            </div>

            {/* Tier 4: Listing quality, visa, viewed & company board preferences */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 pt-4 sm:grid-cols-2">
                <Group label="Posting check" variant={choiceVariant}>
                    <Affordance variant={itemVariant} inputType="radio" active={hideGhosts} onClick={() => onHideGhosts(true)}>
                        {ghostHideLabel}
                    </Affordance>
                    <Affordance variant={itemVariant} inputType="radio" active={!hideGhosts} onClick={() => onHideGhosts(false)}>
                        Show all postings
                    </Affordance>
                </Group>

                <Group label="Viewed" variant={choiceVariant}>
                    <Affordance variant={itemVariant} inputType="radio" active={!hideViewed} onClick={() => onHideViewed(false)}>
                        Show all
                    </Affordance>
                    <Affordance variant={itemVariant} inputType="radio" active={hideViewed} onClick={() => onHideViewed(true)}>
                        Hide already viewed
                    </Affordance>
                </Group>

                <Group
                    label="Visa sponsorship"
                    variant={choiceVariant}
                    caption={visaShare != null ? `~${Math.round(visaShare * 100)}% tagged` : undefined}
                >
                    <Affordance variant={itemVariant} active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)}>
                        Sponsors visas
                    </Affordance>
                </Group>

                {onBoardChange && (
                    <Group label="Boards" variant={choiceVariant}>
                        <Affordance
                            testId="board-filter-elite"
                            variant={itemVariant}
                            inputType="radio"
                            active={board === "elite"}
                            onClick={() => onBoardChange("elite")}
                        >
                            Elite startups
                        </Affordance>
                        <Affordance
                            testId="board-filter-all"
                            variant={itemVariant}
                            inputType="radio"
                            active={board !== "elite"}
                            onClick={() => onBoardChange("all")}
                        >
                            All companies
                        </Affordance>
                    </Group>
                )}
            </div>
        </div>
    );
}
