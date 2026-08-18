/**
 * Pure helpers + shared model for the jobs SERP's filter state. The rendered
 * filter UI itself lives in SerpFilters.tsx (an editorial affordance band,
 * not a card) — this file stays because every helper below is imported by
 * other surfaces (FilterChipsRow, search-payload, page.tsx, SerpFilters) and
 * needs exactly one home.
 */
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_TYPES } from "@/lib/agent/facets";
import { FACETABLE_KEYS, type FacetKey, type PostedBucket } from "@/lib/jobs/types";
import { classifyCountryValue } from "@/lib/jobs/country-classification";
import { GHOST_META } from "@/lib/jobs/presentation";

/**
 * `ghost_badge`'s labels are DERIVED from `GHOST_META`, never restated here.
 *
 * They used to be a second hand-written copy of the same four strings, which
 * is the failure mode this file is now the fix for: renaming the verdicts at
 * their chokepoint left this filter still offering "No ghost signals" while
 * every row said something else. A duplicated label map is a rename that is
 * guaranteed to go half-done.
 *
 * `unscored` has no GHOST_META entry (it is `null` there — nothing has been
 * checked, so there is no verdict to show on a row). The filter still needs a
 * name for it, and that name lives here because this is the only surface that
 * offers it as a choice.
 */
const VALUE_LABELS: Partial<Record<FacetKey, Record<string, string>>> = {
    ghost_badge: {
        ...Object.fromEntries(
            Object.entries(GHOST_META)
                .filter(([, meta]) => meta !== null)
                .map(([value, meta]) => [value, meta!.label]),
        ),
        unscored: "Not checked yet",
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

/** Static facet option ladders — always shown in SerpFilters even when the
 *  current result set's distribution is empty (selected values still merge in). */
export const STATIC_FACET_LADDERS: Partial<Record<FacetKey, readonly string[]>> = {
    work_type: WORK_TYPES,
    experience_level: EXPERIENCE_LEVELS,
    employment_type: EMPLOYMENT_TYPES,
};

/** Non-informative sentinel values — a filter that matches "unknown" is just noise. */
const SENTINEL_VALUES = new Set(["", "unknown", "null", "undefined", "n/a", "none"]);

/** Per-facet extra validity check beyond the sentinel rule above — e.g.
 *  location_country's real-country-membership check. Open/closed: a future
 *  facet earns its own guard by adding a row here, never by growing a chain
 *  of `if (key === ...)` special cases in `isNoiseFacetValue`. */
const FACET_VALUE_VALIDATORS: Partial<Record<FacetKey, (value: string) => boolean>> = {
    location_country: (value) => classifyCountryValue(value).kind === "country",
};

/**
 * True if a facet value is noise we should hide from the filter list. Drops
 * sentinels everywhere, plus (via `FACET_VALUE_VALIDATORS`) any value that
 * fails its facet's own membership check. Data itself is untouched — a
 * dropped value's rows are still findable via search/places; this only
 * controls what renders as a checkable OPTION. Selected values are always
 * kept visible (handled by the caller) so they remain uncheckable.
 */
export function isNoiseFacetValue(key: FacetKey, value: string): boolean {
    if (SENTINEL_VALUES.has(value.trim().toLowerCase())) return true;
    const validator = FACET_VALUE_VALIDATORS[key];
    if (validator && !validator(value)) return true;
    return false;
}

/** Human-friendly label for a facet value (shared with the active-filter chips). */
export function facetValueLabel(key: FacetKey, v: string): string {
    return VALUE_LABELS[key]?.[v] ?? v.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** What to call a facet KEY in a chip that has to say which filter it is
 *  ("Location · Bangalore"), as opposed to `facetValueLabel`'s value side.
 *  The map only overrides where a derived name would read badly; the
 *  fallback humanises the key itself, so a facet added to `FACETABLE_KEYS`
 *  gets a serviceable label without an edit here. */
const KEY_LABELS: Partial<Record<FacetKey, string>> = {
    location_country: "Location",
    work_type: "Work mode",
    experience_level: "Experience",
    employment_type: "Employment",
    visa_sponsorship: "Visa",
    ghost_badge: "Posting status",
};

export function facetKeyLabel(key: FacetKey): string {
    return (
        KEY_LABELS[key] ??
        key.replace(/^location_/, "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    );
}

/**
 * The active filters a caller has to name for itself, because the FacetBar
 * has no control for them (`facetBarRepresents`, FacetBar.tsx). Splitting on
 * ":" recovers the facet key from an `activeFilterEntries` entry key
 * (`"location_country:Bangalore"`); non-facet entries ("salaryMin",
 * "visaOnly", …) have no colon and compare whole.
 *
 * Pure and generic over the entry shape so the toolbar can pass its own
 * already-hoisted `activeEntries` rather than recomputing, and so this is
 * testable without rendering anything.
 */
export function entriesNeedingOwnChip<T extends { key: string }>(
    entries: readonly T[],
    represented: ReadonlySet<string>,
): T[] {
    return entries.filter((e) => !represented.has(e.key.split(":")[0]));
}

/** Chip text for one such entry. A facet entry names its key ("Location ·
 *  Bangalore") because with no dropdown on the bar nothing else on screen
 *  says WHICH filter the value belongs to; the non-facet entries already
 *  read as complete phrases ("Sponsors visas"), so they're left alone. */
export function chipLabelForEntry(entry: { key: string; label: string }): string {
    const [head, ...rest] = entry.key.split(":");
    return rest.length > 0 ? `${facetKeyLabel(head as FacetKey)} · ${entry.label}` : entry.label;
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
    /** `includeQuietDefaults` opts a normally-silent default BACK into the
     *  list — today that's only the pristine "30d" posted-bucket (see below).
     *  The toolbar/mobile-sheet callers omit it (default `undefined`), so
     *  their output is unchanged; the zero-result state (page.tsx) passes
     *  `true` because a silently-applied default is exactly the kind of
     *  excluder that state must name. */
    opts?: { includeQuietDefaults?: boolean },
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

    // Soft Signal: quiet defaults stay out of the pill row. "30d" (pristine)
    // and explicit "Any" (`undefined`) are both non-chips — only finite age
    // buckets (24h / 3d / 7d / …) surface. Clear still restores pristine 30d.
    // `opts.includeQuietDefaults` opts pristine "30d" back in for callers that
    // need it named (see the param doc above) — "Any" stays excluded either
    // way, since an explicit "no filter" never narrowed anything to name.
    const postedIsQuietDefault = state.postedBucket === PRISTINE_FILTER_STATE.postedBucket;
    if (state.postedBucket && (!postedIsQuietDefault || opts?.includeQuietDefaults)) {
        // A clear must always WIDEN. For every finite bucket that ISN'T the
        // pristine default, widening means falling back to pristine 30d — as
        // before. But when the entry only exists BECAUSE the bucket is
        // already the pristine default (the `includeQuietDefaults` path),
        // "restore pristine 30d" is a fixed point (30d → 30d): nothing
        // changes and the excluder survives its own clear. The only value
        // that actually widens FROM pristine 30d is explicit "Any"
        // (`undefined`) — already a first-class `FilterState`/URL value
        // (`parseJobsUrl`/`serializeJobsUrl`, lib/jobs/url-state.ts).
        const widenTo = postedIsQuietDefault ? undefined : PRISTINE_FILTER_STATE.postedBucket;
        entries.push({
            key: "postedBucket",
            label: postedBucketLabel(state.postedBucket),
            clear: (s) => ({ ...s, postedBucket: widenTo }),
        });
    }

    if (state.hideGhosts === false) {
        entries.push({
            key: "hideGhosts",
            label: "Showing possibly stale",
            clear: (s) => ({ ...s, hideGhosts: true }),
        });
    }

    return entries;
}

/**
 * Share (0..1) of `total` explicitly tagged with a real value — the
 * arithmetic behind the sparse-filter honesty captions (work-mode group,
 * visa control, SerpFilters.tsx). `null` when there's nothing to compute
 * against (zero total), so the caller renders no caption rather than a
 * divide-by-zero artifact.
 */
export function taggedShare(tagged: number, total: number): number | null {
    return total > 0 ? tagged / total : null;
}

/**
 * `taggedShare` for a facet distribution shaped like `work_type` — every row
 * carries SOME value, including the sentinel "unknown", so the
 * distribution's own value sum IS the result-set total. `undefined` (facet
 * absent from the response) falls back to `null` — no caption, never a lie.
 */
export function distributionTaggedShare(dist: Record<string, number> | undefined): number | null {
    if (!dist) return null;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    return taggedShare(total - (dist.unknown ?? 0), total);
}

/**
 * `taggedShare` for a BOOLEAN facet distribution shaped like
 * `visa_sponsorship` — Meilisearch omits untagged (null) rows from a boolean
 * facet's distribution entirely (verified live: `{true, false}`, no third
 * bucket), so unlike `distributionTaggedShare` the distribution's own sum is
 * only the TAGGED count; the denominator has to be the result set's overall
 * total, passed in separately.
 */
export function booleanTaggedShare(dist: Record<string, number> | undefined, resultTotal: number): number | null {
    if (!dist) return null;
    const tagged = (dist["true"] ?? 0) + (dist["false"] ?? 0);
    return taggedShare(tagged, resultTotal);
}

