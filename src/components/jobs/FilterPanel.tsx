"use client";

import { useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FACETABLE_KEYS, type FacetDistribution, type FacetKey, type PostedBucket } from "@/lib/jobs/types";

const GROUP_LABELS: Record<FacetKey, string> = {
    work_type: "Work type",
    experience_level: "Experience level",
    employment_type: "Employment type",
    ghost_badge: "Ghost-job risk",
    location_country: "Country",
    source: "Source",
};

const VALUE_LABELS: Partial<Record<FacetKey, Record<string, string>>> = {
    ghost_badge: {
        clear: "No ghost signals",
        caution: "Worth verifying",
        likely_ghost: "Possible ghost",
        unscored: "Unscored",
    },
};

/**
 * Exported for Task 10's mobile "Salary ▾" chip, which cycles through this
 * SAME list rather than re-declaring its own — one preset ladder, not two
 * that could drift.
 */
export const SALARY_PRESETS = [
    { label: "Any", value: 0 },
    { label: "$50k+", value: 50_000 },
    { label: "$100k+", value: 100_000 },
    { label: "$150k+", value: 150_000 },
    { label: "$200k+", value: 200_000 },
];

const POSTED_BUCKET_PRESETS: { label: string; value: PostedBucket | undefined }[] = [
    { label: "Any", value: undefined },
    { label: "Last 24h", value: "1d" },
    { label: "Last 3 days", value: "3d" },
    { label: "Last week", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Older than 30 days", value: "older" },
];

/** Human label for a posted-bucket value, shared with the active-filter chips. */
export function postedBucketLabel(v: PostedBucket): string {
    return POSTED_BUCKET_PRESETS.find((o) => o.value === v)?.label ?? v;
}

const TOP_N = 6;

/** Non-informative sentinel values — a filter that matches "unknown" is just noise. */
const SENTINEL_VALUES = new Set(["", "unknown", "null", "undefined", "n/a", "none"]);

/**
 * True if a facet value is noise we should hide from the filter list. Drops
 * sentinels everywhere, plus junk that leaked into `location_country` (zip
 * codes, coordinate/JSON fragments, stray tokens). The upstream feed normalizes
 * these now (Subspace `toPublicJob`), but the UI stays defensive so a stale
 * index or future regression can't resurface garbage. Selected values are
 * always kept visible (handled by the caller) so they remain uncheckable.
 */
export function isNoiseFacetValue(key: FacetKey, value: string): boolean {
    if (SENTINEL_VALUES.has(value.trim().toLowerCase())) return true;
    if (key === "location_country") {
        if (/[0-9{}[\]"<>:#=]/.test(value)) return true; // zips, coords, JSON fragments
        if (!/[a-z]/i.test(value)) return true; // no letters → not a country
        if (value.length > 40) return true;
    }
    return false;
}

/** Human-friendly label for a facet value (shared with the active-filter chips). */
export function facetValueLabel(key: FacetKey, v: string): string {
    return VALUE_LABELS[key]?.[v] ?? v.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface FilterState {
    facets: Partial<Record<FacetKey, string[]>>;
    salaryMin: number;
    visaOnly: boolean;
    postedBucket: PostedBucket | undefined;
    /** First-screen default true (hide `likely_ghost` postings) — mirrors the URL's `ghosts` param. */
    hideGhosts: boolean;
}

/**
 * The all-filters-cleared FilterState. `hideGhosts: true` is the product
 * default (ghosts hidden by default) — the one field here that ISN'T just
 * "off"/empty like the rest — so this is exported and shared by `clearAll`
 * AND the mobile sheet's `pendingClearAll` (page.tsx), plus this file's own
 * tests, instead of three literals that could quietly drift (review fix,
 * 2026-07-19 — the exact risk `toggleFacetValue` was already extracted to
 * prevent, just for the "cleared" literal instead of the toggle mechanics).
 */
export const PRISTINE_FILTER_STATE: FilterState = {
    facets: {},
    salaryMin: 0,
    visaOnly: false,
    postedBucket: undefined,
    hideGhosts: true,
};

/**
 * Pure add/remove-from-array toggle for one facet key's selected values.
 * Shared by the desktop mutator (`toggleFacet`, page.tsx) and Task 10's
 * mobile sheet pending-state mutator, so there is exactly one place that
 * knows how a facet-value selection list mutates — not two copies that can
 * drift on, e.g., whether removing the last value deletes the key.
 */
export function toggleFacetValue(
    facets: Partial<Record<FacetKey, string[]>>,
    key: FacetKey,
    value: string,
): Partial<Record<FacetKey, string[]>> {
    const cur = facets[key] ?? [];
    const nextValues = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    const next = { ...facets };
    if (nextValues.length) next[key] = nextValues;
    else delete next[key];
    return next;
}

/**
 * Rail layout groups: Date posted, Work type, Minimum salary, and Posting
 * health (the "Hide likely-ghost" toggle) are promoted above the fold;
 * everything else — `MORE_FACETS` plus visa sponsorship — lives inside the
 * collapsible "More filters" group. Exported so Task 10 (mobile sheet) and
 * Task 11 (empty-state suggestions) share the same grouping instead of
 * re-deriving it and risking drift. `"posting_health"` is a UI group name
 * here, not a `FacetKey` — the ghost signal isn't a facet group anymore, it's
 * the toggle row.
 */
export const PROMOTED_GROUPS = ["posted", "work_type", "salary", "posting_health"] as const;
export const MORE_FACETS: FacetKey[] = ["experience_level", "employment_type", "location_country", "source"];

/**
 * Single source of truth for "what filters are active right now" — drives
 * the toolbar chips (page.tsx), the mobile sheet (Task 10), and the empty
 * state's "clear a filter" suggestions (Task 11). `hideGhosts: true` is the
 * default (ghosts hidden), so it is deliberately NOT an active entry; only
 * the deviation (ghosts shown) is. Facet-value labels match the pre-existing
 * chips loop exactly — `facetValueLabel(key, v)` alone, no facet-key prefix.
 */
export function activeFilterEntries(
    state: FilterState,
): { key: string; label: string; clear: (s: FilterState) => FilterState }[] {
    const entries: { key: string; label: string; clear: (s: FilterState) => FilterState }[] = [];

    for (const key of FACETABLE_KEYS) {
        for (const v of state.facets[key] ?? []) {
            entries.push({
                key: `${key}:${v}`,
                label: facetValueLabel(key, v),
                clear: (s) => {
                    const cur = s.facets[key] ?? [];
                    const nextValues = cur.filter((x) => x !== v);
                    const nextFacets = { ...s.facets };
                    if (nextValues.length) nextFacets[key] = nextValues;
                    else delete nextFacets[key];
                    return { ...s, facets: nextFacets };
                },
            });
        }
    }

    if (state.salaryMin > 0) {
        entries.push({
            key: "salaryMin",
            label: `≥ $${Math.round(state.salaryMin / 1000)}k`,
            clear: (s) => ({ ...s, salaryMin: 0 }),
        });
    }

    if (state.visaOnly) {
        entries.push({
            key: "visaOnly",
            label: "Sponsors visas",
            clear: (s) => ({ ...s, visaOnly: false }),
        });
    }

    if (state.postedBucket) {
        entries.push({
            key: "postedBucket",
            label: postedBucketLabel(state.postedBucket),
            clear: (s) => ({ ...s, postedBucket: undefined }),
        });
    }

    if (state.hideGhosts === false) {
        entries.push({
            key: "hideGhosts",
            label: "Showing likely-ghost",
            clear: (s) => ({ ...s, hideGhosts: true }),
        });
    }

    return entries;
}

export function FilterPanel({
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
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [moreOpen, setMoreOpen] = useState(false);
    const toggleCollapse = (k: string) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));
    const toggleExpand = (k: string) => setExpanded((s) => ({ ...s, [k]: !s[k] }));

    // Shared renderer for a single facet group (live counts from `distribution`,
    // noise filtering, top-N + "Show all"). Used for the promoted "Work type"
    // group AND every group inside "More filters" (`MORE_FACETS`) — factored
    // out so there is exactly one place that turns a `FacetKey` into a Section.
    const renderFacetSection = (key: FacetKey) => {
        const dist = distribution?.[key];
        const selected = state.facets[key] ?? [];
        const merged = new Map<string, number>(dist ? Object.entries(dist) : []);
        // Keep selected-but-now-zero values visible so they remain uncheckable.
        for (const v of selected) if (!merged.has(v)) merged.set(v, 0);
        // Drop noise (sentinels + junk country values) unless it's selected.
        const all = [...merged.entries()]
            .filter(([v]) => selected.includes(v) || !isNoiseFacetValue(key, v))
            .sort((a, b) => b[1] - a[1]);
        if (all.length === 0) return null;
        const isExpanded = expanded[key];
        const shown = isExpanded ? all : all.slice(0, TOP_N);
        return (
            <Section
                key={key}
                title={GROUP_LABELS[key]}
                count={selected.length}
                collapsed={collapsed[key]}
                onToggle={() => toggleCollapse(key)}
            >
                <div className="px-2 pb-2">
                    {shown.map(([value, n]) => (
                        <Row
                            key={value}
                            label={facetValueLabel(key, value)}
                            count={n}
                            checked={selected.includes(value)}
                            onClick={() => onToggleFacet(key, value)}
                        />
                    ))}
                    {all.length > TOP_N && (
                        <button
                            onClick={() => toggleExpand(key)}
                            className="mt-1 px-2 text-xs font-medium text-brand hover:underline"
                        >
                            {isExpanded ? "Show less" : `Show all ${all.length}`}
                        </button>
                    )}
                </div>
            </Section>
        );
    };

    const moreFiltersActiveCount =
        (state.visaOnly ? 1 : 0) + MORE_FACETS.reduce((n, k) => n + (state.facets[k]?.length ?? 0), 0);

    return (
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-sm font-semibold">Filters</span>
                {activeCount > 0 && (
                    <button onClick={onClearAll} className="text-xs font-medium text-brand hover:underline">
                        Clear all ({activeCount})
                    </button>
                )}
            </div>

            <div className="min-h-0 flex-1">
                {/* Date posted — recency is a primary job-seeker filter, so it leads.
                    Hidden when the corpus carries no `posted_ts`, since every bucket
                    would return an empty board; it reappears on its own once the data
                    supports it (see `isPostedDateFilterSupported`). */}
                {postedDateSupported && (
                    <Section title="Date posted" collapsed={collapsed.posted} onToggle={() => toggleCollapse("posted")}>
                        <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                            {POSTED_BUCKET_PRESETS.map((o) => (
                                <button
                                    key={o.label}
                                    onClick={() => onPostedBucket(o.value)}
                                    className={cn(
                                        "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                        state.postedBucket === o.value
                                            ? "border-brand/40 bg-brand/10 text-brand"
                                            : "border-border bg-card text-muted-foreground hover:border-brand/30",
                                    )}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </Section>
                )}

                {/* Work type — promoted out of the generic facet loop (PROMOTED_GROUPS). */}
                {renderFacetSection("work_type")}

                {/* Minimum salary */}
                <Section title="Minimum salary" collapsed={collapsed.salary} onToggle={() => toggleCollapse("salary")}>
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                        {SALARY_PRESETS.map((s) => (
                            <button
                                key={s.value}
                                onClick={() => onSalaryMin(s.value)}
                                className={cn(
                                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                    state.salaryMin === s.value
                                        ? "border-brand/40 bg-brand/10 text-brand"
                                        : "border-border bg-card text-muted-foreground hover:border-brand/30",
                                )}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </Section>

                {/* Posting health — replaces the old standalone "Ghost-job risk" facet
                    group with a single default-on toggle. An explicit `ghost_badge`
                    facet arriving via a legacy deep link still applies at the search
                    layer (Task 2 composes it); this rail just no longer renders it as
                    its own group. */}
                <Section
                    title="Posting health"
                    collapsed={collapsed.postingHealth}
                    onToggle={() => toggleCollapse("postingHealth")}
                >
                    <div className="px-2 pb-2">
                        <button
                            type="button"
                            role="checkbox"
                            aria-checked={hideGhosts}
                            aria-label={
                                ghostHiddenCount != null && ghostHiddenCount > 0
                                    ? `Hide likely-ghost, currently hiding ${ghostHiddenCount.toLocaleString()} roles`
                                    : "Hide likely-ghost"
                            }
                            onClick={() => onHideGhosts(!hideGhosts)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
                        >
                            <span
                                className={cn(
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                    hideGhosts ? "border-brand bg-brand text-white" : "border-border",
                                )}
                            >
                                {hideGhosts && <Check size={11} weight="bold" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px]">Hide likely-ghost</span>
                            {ghostHiddenCount != null && ghostHiddenCount > 0 && (
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden>
                                    −{ghostHiddenCount.toLocaleString()}
                                </span>
                            )}
                        </button>
                    </div>
                </Section>

                {/* More filters — visa sponsorship + the long-tail facets
                    (MORE_FACETS), collapsed by default to keep the promoted groups
                    above the fold. */}
                <Section
                    title="More filters"
                    count={moreFiltersActiveCount}
                    collapsed={!moreOpen}
                    onToggle={() => setMoreOpen((v) => !v)}
                >
                    <div className="px-2 pb-2">
                        <Row label="Sponsors visas" checked={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)} />
                    </div>
                    {MORE_FACETS.map((key) => renderFacetSection(key))}
                </Section>
            </div>
        </div>
    );
}

function Section({
    title,
    count,
    collapsed,
    onToggle,
    children,
}: {
    title: string;
    count?: number;
    collapsed?: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    const sectionLabel = count ? `${title}, ${count} selected` : title;
    return (
        <div className="border-b border-border/60 last:border-b-0">
            <button
                onClick={onToggle}
                aria-expanded={!collapsed}
                aria-label={sectionLabel}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
                <span className="text-[13px] font-semibold">
                    {title}
                    {count ? <span className="ml-1.5 text-brand">{count}</span> : null}
                </span>
                <CaretDown
                    size={14}
                    className={cn("text-muted-foreground transition-transform", collapsed && "-rotate-90")}
                />
            </button>
            {!collapsed && children}
        </div>
    );
}

function Row({
    label,
    count,
    checked,
    onClick,
}: {
    label: string;
    count?: number;
    checked: boolean;
    onClick: () => void;
}) {
    const ariaLabel =
        typeof count === "number"
            ? `${label}, ${count.toLocaleString()} matching roles`
            : label;
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={ariaLabel}
            onClick={onClick}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
        >
            <span
                className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-brand bg-brand text-white" : "border-border",
                )}
            >
                {checked && <Check size={11} weight="bold" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
            {typeof count === "number" && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden>
                    {count.toLocaleString()}
                </span>
            )}
        </button>
    );
}
