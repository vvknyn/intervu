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

const SALARY_PRESETS = [
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
}: {
    distribution: FacetDistribution | undefined;
    state: FilterState;
    activeCount: number;
    onToggleFacet: (key: FacetKey, value: string) => void;
    onSalaryMin: (v: number) => void;
    onVisaOnly: (v: boolean) => void;
    onPostedBucket: (v: PostedBucket | undefined) => void;
    onClearAll: () => void;
}) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const toggleCollapse = (k: string) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));
    const toggleExpand = (k: string) => setExpanded((s) => ({ ...s, [k]: !s[k] }));

    return (
        <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-sm font-semibold">Filters</span>
                {activeCount > 0 && (
                    <button onClick={onClearAll} className="text-xs font-medium text-brand hover:underline">
                        Clear all ({activeCount})
                    </button>
                )}
            </div>

            <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
                {/* Date posted — recency is a primary job-seeker filter, so it leads. */}
                <Section title="Date posted" collapsed={collapsed.posted} onToggle={() => toggleCollapse("posted")}>
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3">
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

                {/* Minimum salary */}
                <Section title="Minimum salary" collapsed={collapsed.salary} onToggle={() => toggleCollapse("salary")}>
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3">
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

                {/* Visa sponsorship */}
                <Section title="Visa sponsorship" collapsed={collapsed.visa} onToggle={() => toggleCollapse("visa")}>
                    <div className="px-1.5 pb-2">
                        <Row label="Sponsors visas" checked={state.visaOnly} onClick={() => onVisaOnly(!state.visaOnly)} />
                    </div>
                </Section>

                {/* Facet groups (counts from the live distribution) */}
                {FACETABLE_KEYS.map((key) => {
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
                            <div className="px-1.5 pb-2">
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
                                        className="mt-1 px-2.5 text-xs font-medium text-brand hover:underline"
                                    >
                                        {isExpanded ? "Show less" : `Show all ${all.length}`}
                                    </button>
                                )}
                            </div>
                        </Section>
                    );
                })}
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
    return (
        <div className="border-b border-border/60 last:border-b-0">
            <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
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
    return (
        <button
            onClick={onClick}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted/60"
        >
            <span
                className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-brand bg-brand text-white" : "border-border",
                )}
            >
                {checked && <Check size={11} weight="bold" />}
            </span>
            <span className="flex-1 truncate text-[13px]">{label}</span>
            {typeof count === "number" && (
                <span className="text-xs text-muted-foreground">{count.toLocaleString()}</span>
            )}
        </button>
    );
}
