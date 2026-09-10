/**
 * Pure helpers + shared model for the jobs SERP's filter state. The rendered
 * filter UI itself lives in SerpFilters.tsx (an editorial affordance band,
 * not a card) — this file stays because every helper below is imported by
 * other surfaces (FilterChipsRow, search-payload, page.tsx, SerpFilters) and
 * needs exactly one home.
 */
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_TYPES } from "@/lib/agent/facets";
import { BOARD_META, type BoardId } from "@/lib/boards/types";
import { FACETABLE_KEYS, type FacetKey, type PostedBucket, type YearsExperienceBucket } from "@/lib/jobs/types";
import { classifyCountryValue } from "@/lib/jobs/country-classification";
import { addLocationValue } from "@/lib/jobs/location-suggest";
import { GHOST_META } from "@/lib/jobs/presentation";
import { capitalizeWords } from "@/lib/text-case";

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

/** Shared value+order ladder for the years-of-experience buckets — mirrors
 *  `POSTED_BUCKET_PRESETS` exactly. See `YearsExperienceBucket` (types.ts)
 *  for why "Any" (`undefined`) is also the pristine default here, unlike
 *  posted-date's non-empty "30d" default. */
export const YEARS_EXPERIENCE_PRESETS: { label: string; value: YearsExperienceBucket | undefined }[] = [
    { label: "Any", value: undefined },
    { label: "0–2 years", value: "0-2" },
    { label: "3–5 years", value: "3-5" },
    { label: "6–10 years", value: "6-10" },
    { label: "11+ years", value: "11+" },
];

/** Human label for a years-of-experience bucket value, shared with the active-filter chips. */
export function yearsExperienceLabel(v: YearsExperienceBucket): string {
    return YEARS_EXPERIENCE_PRESETS.find((o) => o.value === v)?.label ?? v;
}

/** How many facet values a group shows before "top N" truncation — shared
 *  with SerpFilters.tsx's country/experience/employment groups. */
export const TOP_N = 6;

/** Mobile location sheet — popular countries first; remote is a separate row. */
export const POPULAR_LOCATION_COUNTRIES = [
    "United States",
    "United Kingdom",
    "Canada",
    "India",
    "Germany",
    "Australia",
    "France",
    "Netherlands",
    "Singapore",
    "Ireland",
] as const;

export type LocationSheetDraft = {
    useDetected: boolean;
    /**
     * EVERY place the sheet has chosen, not one.
     *
     * This was `country: string | null`, so committing the sheet replaced the
     * whole `location_country` list with a single value — mobile could never
     * ask for "Canada and remote", and a phone opening a two-place URL saw
     * only the first one. The corpus, the URL (`?country=a,b`) and
     * `resolveLocationFacet` have all carried a LIST from the start; this
     * field was the last place that collapsed it, and the sheet's own copy
     * ("Pick one or more") already promised otherwise.
     */
    places: string[];
    otherText: string;
    showOther: boolean;
    remote: boolean;
};

/** Applies a location-sheet draft onto filter state — pure, unit-testable. */
export function applyLocationSheetDraft(
    draft: LocationSheetDraft,
    state: FilterState,
    remoteValue: string | undefined,
): FilterState {
    const facets = { ...state.facets };
    if (draft.useDetected) {
        // "Use my detected location" means "stop filtering explicitly and let
        // the server's IP default apply", so it clears the list rather than
        // adding to it.
        delete facets.location_country;
    } else {
        // Free text commits as one more place, folded-deduped through the same
        // helper the desktop picker uses — typing "Montreal" when "Montréal"
        // is already chosen is a no-op, not a second filter for one city.
        const chosen = draft.showOther && draft.otherText.trim()
            ? addLocationValue(draft.places, draft.otherText)
            : draft.places;
        const cleaned = chosen.map((v) => v.trim()).filter(Boolean);
        if (cleaned.length) facets.location_country = cleaned;
        else delete facets.location_country;
    }

    if (remoteValue) {
        const cur = facets.work_type ?? [];
        const has = cur.includes(remoteValue);
        if (draft.remote && !has) facets.work_type = [...cur, remoteValue];
        else if (!draft.remote && has) {
            const next = cur.filter((x) => x !== remoteValue);
            if (next.length) facets.work_type = next;
            else delete facets.work_type;
        }
    }

    return { ...state, facets };
}

/** Moved to `lib/jobs/location-label.ts` (pure, no React/DOM) so it's
 *  importable directly from `node:test` — re-exported here since this is
 *  still the file every caller and existing test imports it from. */
export { LOCATION_TRIGGER_PLACEHOLDER, locationTriggerLabel } from "@/lib/jobs/location-label";

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
    return VALUE_LABELS[key]?.[v] ?? capitalizeWords(v.replace(/[_-]/g, " "));
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
    // Measured 2026-08-29 (Task #48): tech_stack is genuinely populated on
    // non-tech searches too (17 distinct values on a nursing search, 3 on a
    // warehouse search — certifications, licences, equipment, not just
    // programming languages). "Tech stack" is the lie there, not the group,
    // so this is one generic label true for every domain — never a
    // per-domain label map.
    tech_stack: "Skills & tools",
};

export function facetKeyLabel(key: FacetKey): string {
    return (
        KEY_LABELS[key] ??
        capitalizeWords(key.replace(/^location_/, "").replace(/[_-]/g, " "))
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
    /** True when `posted` is in the URL or the user pinned Posted. */
    postedExplicit?: boolean;
    /** Minimum-years-of-experience bucket. `undefined` is both "no filter"
     *  and the pristine default — see `YearsExperienceBucket` (types.ts). */
    yearsExperience: YearsExperienceBucket | undefined;
    /** First-screen default true (hide `likely_ghost` postings) — mirrors the URL's `ghosts` param. */
    hideGhosts: boolean;
    /**
     * Curated-board scope (`?board=elite`). It narrows results HARDER than any
     * facet — an editorial allowlist of a few hundred domains out of the whole
     * corpus — so it lives here, in the one collection that means "everything
     * currently narrowing this search", rather than beside it. Kept outside,
     * it was a filter no chip could name and no clear could reach: it survived
     * every new query and silently capped results, on one device only (it is
     * URL state), which is exactly how it read as "search is broken".
     */
    board: BoardId | null;
    /** Single-employer scope (`?company=…`). Same shape, same reason as `board`. */
    companyDomain: string | null;
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
    yearsExperience: undefined,
    hideGhosts: true,
    board: null,
    companyDomain: null,
};

/**
 * The posted window ACTUALLY in force. The fresh-visit pristine `30d` is a
 * real, product-default narrowing — not a display-only value — so it is
 * applied exactly like a bucket the searcher picked. `undefined` means
 * exactly one thing: the searcher explicitly widened to "Any date"
 * (`postedBucket: undefined`, `postedExplicit: true` — see `parseJobsUrl`,
 * lib/jobs/url-state.ts, for `?posted=any`).
 *
 * Every surface answers "what Posted window is on?" through here — the
 * request gate, the chip row, and all three pickers. The rule having three
 * separate homes (before this function existed) is precisely how the two
 * newest pickers ended up with none.
 */
export function appliedPostedBucket(
    state: Pick<FilterState, "postedBucket">,
): PostedBucket | undefined {
    return state.postedBucket;
}

/**
 * Pure: which fields actually differ between two FilterState snapshots, by
 * field name (`"employment_type"`, `"salaryMin"`, `"board"`, …) — the
 * `search_filter_applied` analytics seam's diff, called from the one
 * `applyFilterState` mutation chokepoint (page.tsx) rather than threading a
 * per-control capture through every caller of `applyFilterState` (chip
 * remove, mobile sheet, location add/clear, board/company scope, …).
 *
 * Deliberately a full field comparison, not `activeFilterEntries`'s active-
 * key set: swapping one selected value for another under the same key (e.g.
 * `location_country` Canada -> US) changes nothing about WHICH keys are
 * active, so a key-set diff would miss it.
 */
export function changedFilterFacets(prev: FilterState, next: FilterState): string[] {
    const changed: string[] = [];
    const facetKeys = new Set([...Object.keys(prev.facets), ...Object.keys(next.facets)]) as Set<FacetKey>;
    for (const key of facetKeys) {
        const prevValues = prev.facets[key] ?? [];
        const nextValues = next.facets[key] ?? [];
        const same =
            prevValues.length === nextValues.length &&
            prevValues.every((v) => nextValues.includes(v)) &&
            nextValues.every((v) => prevValues.includes(v));
        if (!same) changed.push(key);
    }
    if (prev.salaryMin !== next.salaryMin) changed.push("salaryMin");
    if (prev.visaOnly !== next.visaOnly) changed.push("visaOnly");
    if (prev.postedBucket !== next.postedBucket || prev.postedExplicit !== next.postedExplicit) changed.push("postedBucket");
    if (prev.yearsExperience !== next.yearsExperience) changed.push("yearsExperience");
    if (prev.hideGhosts !== next.hideGhosts) changed.push("hideGhosts");
    if (prev.board !== next.board) changed.push("board");
    if (prev.companyDomain !== next.companyDomain) changed.push("companyDomain");
    return changed;
}

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

    // Scope first: it narrows the corpus itself, so it reads ahead of every
    // facet in the chip row. It is an entry at all for one reason — a filter
    // the searcher cannot see is a filter they cannot escape.
    if (state.board) {
        entries.push({
            key: "board",
            label: BOARD_META[state.board].label,
            clear: (s) => ({ ...s, board: null }),
        });
    }

    // `companyDomain` deliberately emits NO entry, despite being a first-class
    // member of `FilterState` alongside `board`. The SERP already renders a
    // dedicated employer token for it ("employer · acme.com ✕",
    // `data-testid="company-scope-chip"`, page.tsx) — richer than a generic
    // chip and mounted where a link-arrived scope belongs. Emitting one here
    // would put TWO removable chips on screen for ONE scope, which is the
    // duplicate-affordance regression this file has already been cleaned of
    // once (ITEM S, 2026-08-15). Membership in `FilterState` is what it needs:
    // that is what puts it inside "clear all" and "clear search".

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

    if (state.yearsExperience) {
        entries.push({
            key: "yearsExperience",
            label: yearsExperienceLabel(state.yearsExperience),
            clear: (s) => ({ ...s, yearsExperience: undefined }),
        });
    }

    // Soft Signal: quiet defaults stay out of the pill row. "30d" (pristine,
    // nobody chose it) and explicit "Any" (`undefined`) are both non-chips —
    // only finite age buckets (24h / 3d / 7d / …) surface. Clear still
    // restores pristine 30d. `opts.includeQuietDefaults` opts pristine "30d"
    // back in for callers that need it named (see the param doc above) —
    // "Any" stays excluded either way, since an explicit "no filter" never
    // narrowed anything to name.
    //
    // Deliberately NOT derived from `appliedPostedBucket`: that predicate
    // answers "is this applied to the request" (pristine 30d: yes, same as
    // a picked 30d), while this answers "did the searcher choose this" (a
    // UI-decluttering call, same family as `hideGhosts`'s silent default
    // below never drawing its own chip either).
    const postedIsQuietDefault = state.postedBucket === PRISTINE_FILTER_STATE.postedBucket && !state.postedExplicit;
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
            clear: (s) => {
                if (postedIsQuietDefault) {
                    return { ...s, postedBucket: undefined, postedExplicit: true };
                }
                const next = { ...s, postedBucket: widenTo };
                delete next.postedExplicit;
                return next;
            },
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
 * Share (0..1 — occasionally over 1, see below) of `resultTotal` tagged with
 * a real value for `dist`: the arithmetic behind the sparse-filter honesty
 * captions (work-mode group, visa control — SerpFilters.tsx) AND the
 * dynamic filter-group coverage gate (`facetGroupVisible` below, Task #48).
 *
 * The denominator is always the CALLER's own result-set total, never the
 * distribution's internal sum — Meilisearch shapes a facet distribution two
 * different ways, and only an external total reads correctly for both:
 *   - Single-valued facets carrying an explicit "unknown" sentinel
 *     (work_type/experience_level/employment_type) — every row contributes
 *     to exactly one bucket, so the distribution's own sum happens to equal
 *     `resultTotal` too; this subtracts `unknown` from it. Exact.
 *   - Facets Meilisearch omits untagged rows from ENTIRELY — booleans
 *     (visa_sponsorship: only `{true, false}` ever appear, verified live —
 *     this used to be a separate `booleanTaggedShare`, folded in here since
 *     it was the same formula with a hardcoded total) and array-valued
 *     facets (tech_stack/must_have_skills/location_country: a job with no
 *     tags contributes no bucket at all). There's no `unknown` key to
 *     subtract, so the whole sum is the tagged count — exact for booleans
 *     (one row, one bucket), an UPPER BOUND for a multi-valued array facet
 *     (one job with two tags adds to two buckets, so this can exceed 1.0).
 *     An upper bound is fine for a threshold gate: it never makes a
 *     genuinely sparse facet look sparser than it is (measured 2026-08-29:
 *     tech_stack read 316% on a software search, ~3% on nursing/warehouse —
 *     the gap the gate below keys off is two orders of magnitude wide
 *     either way the bound leans).
 *
 * `null` when there's nothing to compute against (no distribution, or a
 * non-positive total) — the caller renders no caption / hides the group,
 * never a divide-by-zero artifact or a lie.
 */
export function distributionTaggedShare(
    dist: Record<string, number> | undefined,
    resultTotal: number,
): number | null {
    if (!dist) return null;
    const tagged = Object.entries(dist).reduce((sum, [k, v]) => sum + (k === "unknown" ? 0 : v), 0);
    return taggedShare(tagged, resultTotal);
}

/**
 * Coverage floor for a facet GROUP to render at all (Task #48, Part A —
 * dynamic filters). Measured live 2026-08-29 across three search shapes
 * (`distributionTaggedShare` against each shape's own `resultTotal`; see the
 * PR body for the full per-facet table):
 *   - Facets that must stay visible everywhere (work_type/experience_level/
 *     employment_type/location_country) never read below 39% coverage in
 *     any of the three shapes — tightest observed was experience_level on
 *     the nursing search, 39.4%.
 *   - tech_stack/must_have_skills never rose above ~3.6% on the two
 *     non-tech shapes (nursing, warehouse), vs. 240%+ on the tech shape.
 * 0.15 sits with >2.5x margin on both sides of that gap — comfortably below
 * every legitimate group's floor, comfortably above the tech-facet noise
 * ceiling on searches it doesn't describe.
 */
export const FACET_COVERAGE_FLOOR = 0.15;

/**
 * Whether a facet GROUP earns a place in the panel for the CURRENT result
 * set — two independent gates, both required (Task #48 design doc):
 *   1. Coverage — `distributionTaggedShare(dist, resultTotal) >=
 *      FACET_COVERAGE_FLOOR`. Below the floor, the facet barely describes
 *      this result set at all.
 *   2. Discrimination — at least 2 selectable `options` survive (the caller
 *      computes these via `facetOptions`, which already folds
 *      `STATIC_FACET_LADDERS` in). A facet where every result shares one
 *      value can't narrow anything either.
 * `STATIC_FACET_LADDERS` groups clear #2 by construction — their ladder is
 * always >=3 entries — so coverage alone governs whether THEY appear, per
 * the ruling that the static-ladder guarantee is about values WITHIN a
 * group, not the group's existence. Occupation/domain never appears here: a
 * group's presence is decided purely by how much of THIS result set it
 * describes, not by what was searched for.
 */
export function facetGroupVisible(
    dist: Record<string, number> | undefined,
    resultTotal: number,
    options: readonly unknown[],
): boolean {
    const coverage = distributionTaggedShare(dist, resultTotal);
    return coverage != null && coverage >= FACET_COVERAGE_FLOOR && options.length >= 2;
}

