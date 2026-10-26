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
    taggedShareCaption,
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

function facetOptions(
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
                active && inputType === "radio" && "text-live",
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
 */
/** Error copy shows only what the digit keypad (inputMode="numeric") can type;
 *  the parser still accepts "120k" / "$120,000" from a desktop keyboard or paste. */
export const SALARY_MIN_ERROR = "Enter an amount like 120000.";

function SalaryCustomMinInput({
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
                    <span className="font-normal normal-case tabular-nums text-live">({count})</span>
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
     * `panel` (default) is the full-width expand — the groups sit side by side.
     * `sheet` is the bottom sheet: the same grid, but the sheet's own sticky
     * footer owns "Clear all", so the in-panel reset is left out. `rail` is the
     * dense layout's 232px column, where they must stack.
     *
     * This is a PROP and not a breakpoint because Tailwind's `md:` asks the
     * VIEWPORT how wide it is, not this element. In the dense rail those two
     * answers disagree completely: a 1512px window happily applies
     * `md:grid-cols-4` to a 232px box and packs four columns of radio labels
     * into ~50px each, which overlaps them into an unreadable stack. Only the
     * caller knows which box the filters landed in.
     */
    layout?: "panel" | "sheet" | "rail";
}) {
    const ghostHideLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide possibly stale (−${ghostHiddenCount.toLocaleString()})`
            : "Hide possibly stale";
    const workCaption = taggedShareCaption(distributionTaggedShare(distribution?.work_type, resultTotal ?? 0), "work");
    const visaCaption = taggedShareCaption(distributionTaggedShare(distribution?.visa_sponsorship, resultTotal ?? 0), "visa");

    return (
        <>
            <div
                className={
                    layout === "rail"
                        ? "grid grid-cols-1 gap-y-3"
                        : "grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 md:grid-cols-4"
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
                    <SalaryCustomMinInput salaryMin={state.salaryMin} onSalaryMin={onSalaryMin} />
                </Group>

                <FacetGroup
                    label="Work mode"
                    facetKey="work_type"
                    distribution={distribution}
                    resultTotal={resultTotal ?? 0}
                    state={state}
                    onToggleFacet={onToggleFacet}
                    caption={workCaption}
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
                        {/* Caption nests inside the label's text column instead of a
                            sibling <p> aligned to it with a pl-[icon-width+gap] literal
                            — it inherits the column's left edge for free. stopPropagation
                            keeps the caption inert (info only, not part of the toggle
                            target), matching the old sibling <p>'s behavior. */}
                        <span className="flex flex-col gap-0.5">
                            <span>Sponsors visas</span>
                            {visaCaption && (
                                <span
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs leading-snug text-muted-foreground"
                                >
                                    {visaCaption}
                                </span>
                            )}
                        </span>
                    </Affordance>
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

            {activeCount > 0 && layout !== "sheet" && (
                <div className="mt-2 flex justify-end border-t border-border pt-2">
                    <Button variant="ghost" size="xs" onClick={onClearAll}>
                        Reset all ✕
                    </Button>
                </div>
            )}
        </>
    );
}
