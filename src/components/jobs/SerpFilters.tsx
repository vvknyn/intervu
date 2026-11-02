"use client";

import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Disclosure, DisclosureCaret, DisclosureSummary } from "@/components/ui/disclosure";
import { filterCountBadgeClass } from "@/components/ui/chip";
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
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "@/components/jobs/FilterPanel";

/** An option row: body-size text, and a 44px tap row below lg where the filters are a sheet. */
const ROW_CLASS = "text-sm max-lg:min-h-11";

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

/** One checkbox or radio row: its label, and the live count when there is one. */
export function Affordance({
    active,
    onClick,
    count,
    children,
    testId,
    inputType = "checkbox",
    className,
}: {
    active: boolean;
    onClick: () => void;
    count?: number;
    children: React.ReactNode;
    testId?: string;
    inputType?: "checkbox" | "radio";
    className?: string;
}) {
    return (
        <label
            data-testid={testId}
            className={cn(
                "flex min-h-8 cursor-pointer items-center gap-2 rounded-ctl px-1.5 text-xs leading-tight text-foreground transition-colors hover:bg-muted",
                active && inputType === "radio" && "font-semibold text-live",
                className,
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
        <label className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1.5 text-xs text-foreground">
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

/**
 * One collapsible group of the filter column. Native `<details>` (the
 * app's one disclosure, ui/disclosure.tsx): the browser owns the keyboard.
 *
 * Open from the first paint when the group is one the searcher reaches for
 * first (`primary`) or already carries a choice (`engaged`), so a link that
 * arrives with filters set never hides them behind a closed header. A group
 * that gains its first choice while closed opens by itself; closing one by
 * hand is never undone. The header names what the group holds right now — a
 * count for a multi-select, the chosen value for a single choice — so a column
 * folded to its headers still says what is applied.
 */
function FilterSection({
    id,
    label,
    count = 0,
    summary,
    chosen = false,
    primary = false,
    note,
    children,
}: {
    id: string;
    label: string;
    /** Selections in a multi-select group. 0 draws no badge. */
    count?: number;
    /** The value of a single-choice group, shown beside the label. */
    summary?: string;
    /** A single-choice group holds something other than its default. */
    chosen?: boolean;
    primary?: boolean;
    /** A muted footnote under the options (the sparse-data honesty caption). */
    note?: string;
    children: React.ReactNode;
}) {
    const engaged = count > 0 || chosen;
    // Open by default for the primary groups and for any group holding a selection;
    // once the searcher opens or closes it themselves, that choice stands.
    const [picked, setPicked] = useState<boolean | null>(null);
    const open = picked ?? (primary || engaged);
    return (
        <Disclosure
            open={open}
            onToggle={(e) => setPicked(e.currentTarget.open)}
            data-testid={`filter-section-${id}`}
            className="border-b border-border last:border-b-0"
        >
            <DisclosureSummary
                marker={false}
                className="ctl-md ctl-button ctl-grow flex w-full items-center gap-2 py-1 text-foreground"
            >
                <span className="min-w-0 flex-1 text-left">{label}</span>
                {count > 0 && <span className={filterCountBadgeClass}>{count}</span>}
                {summary && <span className="shrink-0 text-xs font-normal text-muted-foreground">{summary}</span>}
                <DisclosureCaret className="shrink-0 text-muted-foreground" />
            </DisclosureSummary>
            <div className="flex flex-col gap-0.5 pb-3 pt-1">
                {children}
                {note && <p className="px-1.5 pt-1 text-xs text-muted-foreground">{note}</p>}
            </div>
        </Disclosure>
    );
}

const SEARCH_PILLS_PLACEHOLDER: Partial<Record<PanelFacetKey, string>> = {
    location_country: "Search countries to add…",
    tech_stack: "Search skills or tools to add…",
    must_have_skills: "Search must-have skills to add…",
};

/** A facet with too many values to list: a search box, what is selected, and the
 *  values that match — added with one tap, searched by typing. */
function SearchPillsFacetSection({
    label,
    facetKey,
    distribution,
    resultTotal,
    state,
    onToggleFacet,
    cap = TOP_N,
}: {
    label: string;
    facetKey: PanelFacetKey;
    distribution: FacetDistribution | undefined;
    resultTotal: number;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
}) {
    const selected = state.facets[facetKey] ?? [];
    const [searchQuery, setSearchQuery] = useState("");
    const [expanded, setExpanded] = useState(false);

    const allOptions = useMemo(
        () => facetOptions(distribution, selected, facetKey, undefined, STATIC_FACET_LADDERS[facetKey]),
        [distribution, selected, facetKey],
    );

    if (selected.length === 0 && !facetGroupVisible(distribution?.[facetKey], resultTotal, allOptions)) return null;

    const countMap = new Map(allOptions);
    const trimmedQuery = searchQuery.trim().toLowerCase();

    const unselectedOptions = allOptions.filter(([value]) => !selected.includes(value));
    const matchingUnselected = trimmedQuery
        ? unselectedOptions.filter(([value]) => {
              const display = facetValueLabel(facetKey, value).toLowerCase();
              return display.includes(trimmedQuery) || value.toLowerCase().includes(trimmedQuery);
          })
        : unselectedOptions;

    const visibleLimit = trimmedQuery ? 24 : expanded ? 24 : cap;
    const visibleSuggestions = matchingUnselected.slice(0, visibleLimit);
    const hiddenCount = Math.max(0, matchingUnselected.length - visibleSuggestions.length);

    return (
        <FilterSection id={facetKey} label={label} count={selected.length}>
            <div className="flex flex-col gap-2.5 px-1.5">
                <div className="flex min-h-8 items-center gap-2 rounded-ctl border border-border bg-background px-2.5 py-1 focus-within:border-foreground">
                    <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && trimmedQuery && visibleSuggestions.length > 0) {
                                e.preventDefault();
                                const [firstVal] = visibleSuggestions[0]!;
                                onToggleFacet(facetKey, firstVal);
                                setSearchQuery("");
                            }
                        }}
                        placeholder={SEARCH_PILLS_PLACEHOLDER[facetKey] ?? `Search ${label.toLowerCase()}…`}
                        aria-label={`Search ${label}`}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            aria-label={`Clear ${label} search`}
                            onClick={() => setSearchQuery("")}
                            className="flex items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                            <X size={16} aria-hidden />
                        </button>
                    )}
                </div>

                {selected.length > 0 && (
                    <div className="flex flex-wrap gap-x-1.5 gap-y-3">
                        {selected.map((value) => {
                            const n = countMap.get(value) ?? 0;
                            return (
                                <label
                                    key={value}
                                    className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-ctl border border-brand bg-live-tint-bg px-2.5 py-1 text-xs font-semibold leading-tight text-brand transition-colors"
                                >
                                    <input
                                        type="checkbox"
                                        checked={true}
                                        readOnly
                                        onClick={() => onToggleFacet(facetKey, value)}
                                        className="sr-only"
                                    />
                                    <span>{facetValueLabel(facetKey, value)}</span>
                                    {n > 0 && (
                                        <span className="text-xs font-normal text-brand tabular-nums">{n.toLocaleString()}</span>
                                    )}
                                    <X size={16} className="shrink-0 text-brand" aria-hidden />
                                </label>
                            );
                        })}
                    </div>
                )}

                {visibleSuggestions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
                        {visibleSuggestions.map(([value, n]) => (
                            <label
                                key={value}
                                className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-ctl border border-border bg-background px-2.5 py-1 text-xs leading-tight text-foreground transition-colors hover:bg-muted"
                            >
                                <input
                                    type="checkbox"
                                    checked={false}
                                    readOnly
                                    onClick={() => {
                                        onToggleFacet(facetKey, value);
                                        if (trimmedQuery) setSearchQuery("");
                                    }}
                                    className="sr-only"
                                />
                                <Plus size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                                <span>{facetValueLabel(facetKey, value)}</span>
                                {n > 0 && (
                                    <span className="text-xs text-muted-foreground tabular-nums">{n.toLocaleString()}</span>
                                )}
                            </label>
                        ))}
                        {!trimmedQuery && (hiddenCount > 0 || expanded) && (
                            <button
                                type="button"
                                onClick={() => setExpanded((prev) => !prev)}
                                className="px-1.5 text-xs font-semibold text-brand hover:underline"
                            >
                                {expanded ? "Show less" : `+${hiddenCount} more`}
                            </button>
                        )}
                    </div>
                ) : trimmedQuery ? (
                    <p className="text-xs text-muted-foreground">No matching options in current results.</p>
                ) : null}
            </div>
        </FilterSection>
    );
}

/** A facet the searcher can pick several values of: one checkbox row per value, with its live count. */
function FacetSection({
    label,
    facetKey,
    primary,
    distribution,
    resultTotal,
    state,
    onToggleFacet,
    cap,
    note,
}: {
    label: string;
    /** Typed off PANEL_FACET_KEYS (jobs/types.ts) — the same set MCP's
     *  search_jobs `facets` input accepts — so a generic picker for a key
     *  outside it is a typecheck error, not a silent drift between surfaces. */
    facetKey: PanelFacetKey;
    primary?: boolean;
    distribution: FacetDistribution | undefined;
    resultTotal: number;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    cap?: number;
    /** Built from the facet's tagged share once the group is known to show. */
    note?: (share: number | null) => string | undefined;
}) {
    const selected = state.facets[facetKey] ?? [];
    const options = facetOptions(distribution, selected, facetKey, cap, STATIC_FACET_LADDERS[facetKey]);
    // A group holding a selection stays, whatever the current results say about it:
    // a rail that dropped "Work mode" on a zero-result list would hide the very
    // filter that emptied it.
    if (selected.length === 0 && !facetGroupVisible(distribution?.[facetKey], resultTotal, options)) return null;
    const share = distributionTaggedShare(distribution?.[facetKey], resultTotal);
    return (
        <FilterSection id={facetKey} label={label} count={selected.length} primary={primary} note={note?.(share)}>
            {options.map(([value, n]) => (
                <Affordance
                    key={value}
                    active={selected.includes(value)}
                    count={n > 0 ? n : undefined}
                    onClick={() => onToggleFacet(facetKey, value)}
                    className={ROW_CLASS}
                >
                    {facetValueLabel(facetKey, value)}
                </Affordance>
            ))}
        </FilterSection>
    );
}

const taggedNote = (share: number | null) => (share != null ? `~${Math.round(share * 100)}% tagged` : undefined);

/** "$100k+" for a floor on or off the preset ladder, so a hand-edited URL still names its value. */
function salaryFloorLabel(salaryMin: number): string {
    return SALARY_PRESETS.find((s) => s.value === salaryMin)?.label ?? `$${Math.round(salaryMin / 1000)}k+`;
}

/**
 * The filter groups, as one column of collapsible sections. The same list
 * serves the left rail on a laptop and the sheet on a phone (the caller wraps
 * it); nothing here knows which. Every control is a thin wrapper over the
 * callbacks `JobsContent` owns, so this component holds no filter state of its
 * own beyond which sections are folded.
 */
export function SerpFilters({
    distribution,
    resultTotal,
    state,
    onToggleFacet,
    onSalaryMin,
    onVisaOnly,
    onPostedBucket,
    onYearsExperience,
    hideGhosts,
    onHideGhosts,
    ghostHiddenCount,
    hideViewed,
    onHideViewed,
    postedDateSupported,
    board,
    onBoardChange,
}: {
    distribution: FacetDistribution | undefined;
    resultTotal?: number;
    state: FilterState;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    onVisaOnly: (v: boolean) => void;
    onPostedBucket: (v: PostedBucket | undefined) => void;
    onYearsExperience: (v: YearsExperienceBucket | undefined) => void;
    hideGhosts: boolean;
    onHideGhosts: (v: boolean) => void;
    ghostHiddenCount: number | null;
    hideViewed: boolean;
    onHideViewed: (v: boolean) => void;
    postedDateSupported: boolean;
    board?: "all" | "elite";
    onBoardChange?: (b: "all" | "elite") => void;
}) {
    const total = resultTotal ?? 0;
    const posted = appliedPostedBucket(state);
    const visaShare = distributionTaggedShare(distribution?.visa_sponsorship, total);
    const years = state.yearsExperience;
    const listingsCount = (hideGhosts ? 0 : 1) + (hideViewed ? 1 : 0) + (board === "elite" ? 1 : 0);
    const ghostLabel =
        hideGhosts && ghostHiddenCount != null && ghostHiddenCount > 0
            ? `Hide possibly stale (−${ghostHiddenCount.toLocaleString()})`
            : "Hide possibly stale";
    const common = { distribution, resultTotal: total, state, onToggleFacet };

    return (
        // One column: every section starts on the same left edge (J-MOB-11).
        <div className="grid grid-cols-1">
            {postedDateSupported && (
                <FilterSection
                    id="posted"
                    label="Date posted"
                    chosen={posted !== appliedPostedBucket(PRISTINE_FILTER_STATE)}
                    summary={posted ? (DATE_POSTED_SHORT_LABELS[posted] ?? posted) : "Any date"}
                >
                    {POSTED_BUCKET_PRESETS.map((o) => (
                        <Affordance
                            key={o.label}
                            inputType="radio"
                            active={posted === o.value}
                            onClick={() => onPostedBucket(o.value)}
                            className={ROW_CLASS}
                        >
                            {o.value ? (DATE_POSTED_SHORT_LABELS[o.value] ?? o.label) : "Any date"}
                        </Affordance>
                    ))}
                </FilterSection>
            )}

            <FilterSection
                id="salary"
                label="Minimum salary"
                chosen={state.salaryMin > 0}
                summary={state.salaryMin > 0 ? salaryFloorLabel(state.salaryMin) : undefined}
            >
                {SALARY_PRESETS.map((s) => (
                    <Affordance
                        key={s.value}
                        inputType="radio"
                        active={state.salaryMin === s.value}
                        onClick={() => onSalaryMin(s.value)}
                        className={ROW_CLASS}
                    >
                        {s.label}
                    </Affordance>
                ))}
                <SalaryCustomMinInput salaryMin={state.salaryMin} onSalaryMin={onSalaryMin} />
            </FilterSection>

            <FacetSection {...common} label="Work mode" facetKey="work_type" primary note={taggedNote} />

            <FacetSection {...common} label="Experience level" facetKey="experience_level" primary cap={TOP_N} />

            <FilterSection
                id="years"
                label="Years of experience"
                chosen={Boolean(years)}
                summary={years ? YEARS_EXPERIENCE_PRESETS.find((o) => o.value === years)?.label : undefined}
            >
                {YEARS_EXPERIENCE_PRESETS.map((o) => (
                    <Affordance
                        key={o.label}
                        inputType="radio"
                        active={years === o.value}
                        onClick={() => onYearsExperience(o.value)}
                        className={ROW_CLASS}
                    >
                        {o.label}
                    </Affordance>
                ))}
            </FilterSection>

            <FacetSection {...common} label="Employment type" facetKey="employment_type" cap={TOP_N} />

            <SearchPillsFacetSection {...common} label="Country" facetKey="location_country" />
            <SearchPillsFacetSection {...common} label={facetKeyLabel("tech_stack")} facetKey="tech_stack" />
            <SearchPillsFacetSection {...common} label="Must-have skills" facetKey="must_have_skills" />

            <FilterSection
                id="visa"
                label="Visa sponsorship"
                count={state.visaOnly ? 1 : 0}
                note={taggedNote(visaShare)}
            >
                <Affordance active={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)} className={ROW_CLASS}>
                    Sponsors visas
                </Affordance>
            </FilterSection>

            <FilterSection id="listings" label="Listings" count={listingsCount}>
                <Affordance active={hideGhosts} onClick={() => onHideGhosts(!hideGhosts)} className={ROW_CLASS}>
                    {ghostLabel}
                </Affordance>
                <Affordance active={hideViewed} onClick={() => onHideViewed(!hideViewed)} className={ROW_CLASS}>
                    Hide already viewed
                </Affordance>
                {onBoardChange && (
                    <Affordance
                        testId="board-filter-elite"
                        active={board === "elite"}
                        onClick={() => onBoardChange(board === "elite" ? "all" : "elite")}
                        className={ROW_CLASS}
                    >
                        Elite startups only
                    </Affordance>
                )}
            </FilterSection>
        </div>
    );
}
