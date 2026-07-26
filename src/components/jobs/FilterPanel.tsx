/**
 * Pure helpers + shared model for the jobs SERP's filter state. The rendered
 * filter UI itself lives in SerpFilters.tsx (an editorial affordance band,
 * not a card) — this file stays because every helper below is imported by
 * other surfaces (FilterChipsRow, search-payload, page.tsx, SerpFilters) and
 * needs exactly one home.
 */
import { FACETABLE_KEYS, type FacetKey, type PostedBucket } from "@/lib/jobs/types";

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

/** Shared value+order ladder for the posted-date buckets — SerpFilters.tsx
 *  relabels these (short chip text) rather than re-declaring the ladder. */
export const POSTED_BUCKET_PRESETS: { label: string; value: PostedBucket | undefined }[] = [
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

/** How many facet values a group shows before "top N" truncation — shared
 *  with SerpFilters.tsx's country/experience/employment groups. */
export const TOP_N = 6;

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
    postedBucket: "30d",
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

    // "30d" is now the default (product decision) — like `hideGhosts`, the
    // default itself isn't an active choice and gets no chip. Anything ELSE
    // is, INCLUDING explicit "Any" (`undefined`): with a non-empty default,
    // picking "Any" is a deliberate departure from it, not a neutral resting
    // state, so it earns its own chip rather than rendering nothing.
    // "Clear" always returns to the shared default, not to "Any".
    if (state.postedBucket !== PRISTINE_FILTER_STATE.postedBucket) {
        entries.push({
            key: "postedBucket",
            label: state.postedBucket ? postedBucketLabel(state.postedBucket) : "Any date",
            clear: (s) => ({ ...s, postedBucket: PRISTINE_FILTER_STATE.postedBucket }),
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

