/**
 * Typeahead model for the location box: turns raw Meilisearch facet-search
 * hits into the grouped, de-duplicated suggestions the picker renders.
 *
 * Everything here is pure so the ranking and folding rules are testable
 * without a backend; the I/O lives in `/api/jobs/locations`.
 *
 * Why this exists at all: until now the desktop location control was a bare
 * text input. A searcher had to already know how this corpus spells a place
 * before it could filter on one, and had no way to tell a city apart from a
 * region with the same name, or to see that a place has any postings before
 * committing to it. The counts below are the whole point — they are the only
 * honest answer to "is it worth filtering here".
 */
import { foldForMatch } from "@/lib/geo/corpus-values";
import { isMalformedLocationValue } from "@/lib/geo/malformed-location-value";
import { parseWorkTypeTokens } from "@/lib/jobs/query-understanding";
import { capitalizeWords } from "@/lib/text-case";
import type { LocationField } from "@/lib/geo/resolve-place";
import type { FacetHit } from "@/lib/geo/corpus-values";

/**
 * Which facet a suggestion writes when committed. A picked CITY or STATE
 * suggestion writes its OWN field (`location_city`/`location_state`) — see
 * `addLocation` in page.tsx — so it's filtered as the exact literal it was
 * advertised and counted as (`resolvePickedFacetValue`,
 * query-understanding.ts), never re-resolved as free text through the
 * gazetteer. A picked COUNTRY suggestion still writes `location_country`,
 * the same bucket free-typed text uses: country picks were never the source
 * of the mis-resolution this fields-through-the-click design exists to fix
 * (see the module doc's "San Jose" / composite-value bug), and that bucket
 * already runs the full gazetteer + exact-literal pipeline. The one
 * suggestion that targets something else entirely is the bare-work-mode
 * row, hence a widened union here rather than a new type per field.
 */
export type SuggestField = LocationField | "work_type";

/** One selectable place, already merged across the corpus's spellings of it. */
export interface LocationSuggestion {
    /** Stable identity for React keys and selection equality: field + folded
     *  value, so the two spellings of one city are ONE suggestion. */
    key: string;
    /** What the searcher sees, and what gets committed to the filter. The
     *  corpus's own dominant spelling — never a re-cased or de-accented
     *  invention, because this string has to survive a round trip back
     *  through place resolution. */
    label: string;
    field: SuggestField;
    /** Postings across EVERY spelling that folds to this one, which is the
     *  number the searcher is actually choosing between. Summing is what
     *  stops Montréal (1,208) from looking like a third of the city when
     *  Montreal (2,306) sits right above it as a separate row. */
    count: number;
}

/** Suggestions for one location field, with the heading the picker shows. */
export interface LocationSuggestGroup {
    field: SuggestField;
    heading: string;
    items: LocationSuggestion[];
}

/**
 * Field order in the dropdown, narrowest first.
 *
 * Deliberately NOT ordered by count: countries carry order-of-magnitude more
 * postings than cities, so a global count sort would bury every city under
 * "United States" forever — the exact opposite of what someone typing three
 * letters of a city name is asking for.
 */
export const LOCATION_SUGGEST_FIELDS: { field: LocationField; heading: string }[] = [
    { field: "location_city", heading: "Cities" },
    { field: "location_state", heading: "States & regions" },
    { field: "location_country", heading: "Countries" },
];

/**
 * How a typed location query splits into a facet search plus an optional
 * work-mode qualifier.
 *
 * Someone typing "remote can" means remote roles in Canada. The corpus cannot
 * answer that as a place name, so the literal string only matches junk that
 * employers typed into their own location field — measured on the live index
 * 2026-08-24, "remote can" offered "Remote – Canada & United States" with a
 * count of ONE, while remote-in-Canada is 6,097. The searcher is handed a
 * plausible row that returns nothing and concludes search is broken.
 *
 * So the work-mode words are split off and become a FILTER on the facet
 * search, exactly as `resolveLocationFacet` already splits them off when the
 * value is committed — the same `parseWorkTypeTokens` on both sides, so what
 * the dropdown offers and what the filter then does cannot drift.
 *
 * Two consequences worth stating:
 *  - The count stays honest. Meili's facet-search accepts a filter, so the
 *    number shown is the true intersection (Canada 63,936 unfiltered ->
 *    6,097 remote), not the place's total. This list's count is the whole
 *    reason to open it; a place total beside a work-mode label would promise
 *    a result set the search then would not return.
 *  - `labelPrefix` rides on the suggestion's `label`, which is BOTH what the
 *    searcher sees and what gets committed. So selecting the row commits
 *    "Remote Canada", which round-trips back through the same parser into a
 *    Canada place clause carrying work_type "remote". No new field, and no
 *    second code path for the picker versus typing it by hand.
 *
 * A bare work mode with NO place after it ("remote") has no residual text to
 * facet-search at all — searching the literal word against place NAMES only
 * ever turns up corpus junk that merely contains it ("Remote Only",
 * "Remote/California", each a count of one), while the honest answer —
 * every remote posting — is unreachable from the dropdown. So this case
 * skips place facet-search entirely: `workModeOnly` carries the parsed
 * modes for the caller to turn into ONE suggestion targeting the work_type
 * facet directly (`buildWorkModeSuggestion`), not a location.
 */
export interface LocationQueryPlan {
    /** What to facet-search for — the place words only. Empty when the
     *  query was pure work-mode text (`workModeOnly` is set instead). */
    facetQuery: string;
    /** Meili filter binding the typed work modes, or undefined when none. */
    filter?: string;
    /** Prefixed onto every suggestion label so choosing one commits the mode. */
    labelPrefix: string;
    /** Set when the ENTIRE query was work-mode words with no place text left
     *  over — there is nothing to facet-search for a place. */
    workModeOnly?: readonly string[];
}

export function planLocationQuery(raw: string): LocationQueryPlan {
    const { residualQ, workTypes } = parseWorkTypeTokens(raw);
    if (workTypes.length === 0) {
        return { facetQuery: raw.trim(), labelPrefix: "" };
    }
    if (!residualQ) {
        return { facetQuery: "", labelPrefix: "", workModeOnly: workTypes };
    }
    return {
        facetQuery: residualQ,
        // Same shape as the committed-clause filter in meilisearch.ts, so the
        // preview and the search agree by construction.
        filter: "(" + workTypes.map((v) => `work_type = ${JSON.stringify(v)}`).join(" OR ") + ")",
        labelPrefix: capitalizeWords(workTypes.join(" ")) + " ",
    };
}

/**
 * Build the single suggestion for a bare work-mode query ("remote",
 * "hybrid"). Pure: `hits` are the ALREADY-FETCHED corpus counts for the
 * `work_type` facet itself (same `fetchFacetSearch` call every place row's
 * count goes through), so the number shown is measured, never invented.
 *
 * Returns null — omit, don't show a wrong number — when the facet couldn't
 * be asked (`hits === null`, same convention `buildLocationSuggestions` uses
 * for an absent field) or when none of the requested modes turned up a hit,
 * mirroring `buildLocationSuggestions`'s "no items, no group" rule rather
 * than rendering a row promising a count that isn't real.
 */
export function buildWorkModeSuggestion(
    workTypes: readonly string[],
    hits: readonly FacetHit[] | null,
): LocationSuggestGroup | null {
    if (workTypes.length === 0 || !hits) return null;
    const wanted = new Set(workTypes);
    const count = hits.filter((h) => wanted.has(h.value)).reduce((n, h) => n + h.count, 0);
    if (count === 0) return null;
    return {
        field: "work_type",
        heading: "Work mode",
        items: [
            {
                key: `work_type:${workTypes.join("+")}`,
                label: `${capitalizeWords(workTypes.join(" "))} — anywhere`,
                field: "work_type",
                count,
            },
        ],
    };
}

/** Apply a plan's work-mode prefix to already-built groups. Separate from
 *  `buildLocationSuggestions` because merging spellings and labelling a mode
 *  are different jobs, and only one of them depends on what was typed. */
export function applyLabelPrefix(
    groups: LocationSuggestGroup[],
    labelPrefix: string,
): LocationSuggestGroup[] {
    if (!labelPrefix) return groups;
    return groups.map((g) => ({
        ...g,
        items: g.items.map((item) => ({
            ...item,
            // The key carries the prefix too: "Canada" and "Remote Canada" are
            // different choices and must not collide as React keys or in the
            // already-chosen check.
            key: `${labelPrefix}${item.key}`,
            label: `${labelPrefix}${item.label}`,
        })),
    }));
}

/** Per-field cap. Small on purpose: a picker is for choosing, not browsing. */
export const LOCATION_SUGGEST_PER_FIELD = 5;

/**
 * Merge one field's raw facet hits into suggestions.
 *
 * Folding is the same transform place resolution matches on
 * (`foldForMatch`), so what the picker shows as one row is exactly what the
 * filter will treat as one place. If these two ever disagreed, the dropdown
 * would promise a count it then failed to return — so they share one
 * definition rather than each keeping their own.
 */
export function mergeFieldHits(
    field: LocationField,
    hits: readonly FacetHit[],
    perField = LOCATION_SUGGEST_PER_FIELD,
): LocationSuggestion[] {
    const groups = new Map<string, { total: number; best: FacetHit }>();

    for (const hit of hits) {
        // Positive-evidence-only: a value that looks like a parser artifact
        // (unbalanced parenthesis, a raw delimiter character, collapsed
        // whitespace) is dropped here rather than rendered as a selectable
        // trap. A value this module simply doesn't recognize is NOT evidence
        // of malformation and still renders — see isMalformedLocationValue's
        // doc for why absence of gazetteer knowledge never suppresses.
        if (isMalformedLocationValue(hit.value)) continue;
        const folded = foldForMatch(hit.value);
        if (!folded) continue;
        const existing = groups.get(folded);
        if (!existing) {
            groups.set(folded, { total: hit.count, best: hit });
            continue;
        }
        existing.total += hit.count;
        // The label is the spelling the corpus uses MOST. Ties keep the one
        // seen first, which is Meilisearch's own count-descending order.
        if (hit.count > existing.best.count) existing.best = hit;
    }

    return [...groups.entries()]
        .map(([folded, g]) => ({
            key: `${field}:${folded}`,
            label: g.best.value,
            field,
            count: g.total,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, perField);
}

/**
 * Build the full grouped dropdown from per-field hits.
 *
 * `hitsByField` may be missing a field entirely — `fetchFacetSearch` returns
 * null when it couldn't ask (no backend, network failure), and a field that
 * couldn't be asked must render as absent rather than as an empty "no
 * matches", which would be a different and false claim.
 */
export function buildLocationSuggestions(
    hitsByField: Partial<Record<LocationField, readonly FacetHit[]>>,
    perField = LOCATION_SUGGEST_PER_FIELD,
): LocationSuggestGroup[] {
    const out: LocationSuggestGroup[] = [];
    for (const { field, heading } of LOCATION_SUGGEST_FIELDS) {
        const hits = hitsByField[field];
        if (!hits) continue;
        const items = mergeFieldHits(field, hits, perField);
        if (items.length > 0) out.push({ field, heading, items });
    }
    return out;
}

/**
 * Is `value` already chosen? Compared on the FOLDED string, not the raw one,
 * so a place committed as "Montreal" counts as chosen when asked about
 * "Montréal" — they are one place, and treating them as two would re-introduce
 * the split the fold exists to close.
 *
 * This is the ONE definition of "already chosen". It was inlined identically
 * in three helpers here; the mobile sheet needs it as a predicate of its own
 * (to render a row as on/off), and a fourth copy is how the desktop picker and
 * the sheet would start disagreeing about what counts as the same place.
 */
export function hasLocationValue(selected: readonly string[], value: string): boolean {
    const folded = foldForMatch(value);
    if (!folded) return false;
    return selected.some((s) => foldForMatch(s) === folded);
}

/** Is this suggestion already chosen? Folded-compared — see `hasLocationValue`. */
export function isLocationSelected(suggestion: LocationSuggestion, selected: readonly string[]): boolean {
    return hasLocationValue(selected, suggestion.label);
}

/**
 * Add a location to the committed list.
 *
 * Pure, and shared by the desktop picker, the free-text Enter path and the
 * mobile sheet's toggles, so "what counts as already added" cannot drift
 * between them.
 * Returns the SAME array when nothing changes, letting callers skip a no-op
 * state write (and the URL replace that rides along with it).
 */
export function addLocationValue(selected: readonly string[], value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return selected as string[];
    if (hasLocationValue(selected, trimmed)) return selected as string[];
    return [...selected, trimmed];
}

/** Remove a location by value, folded-compared for the same reason as above. */
export function removeLocationValue(selected: readonly string[], value: string): string[] {
    const folded = foldForMatch(value);
    return selected.filter((s) => foldForMatch(s) !== folded);
}
