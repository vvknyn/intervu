/**
 * Location disclosure for the mobile trigger — the applied IP-geo default
 * (2026-09-10, "auto location detect is not working" bug), surfaced whenever
 * the server actually applied one and the searcher hasn't chosen a place of
 * their own — plus `detectedLocationLabel`, the one "(detected)" formatter
 * this file and the location sheet's own detected-label both call.
 *
 * Pure module (no React/DOM) so it's importable from `node:test` directly —
 * split out of FilterPanel.tsx, which pulls in React/JSX and can't be
 * required standalone under the test runner.
 *
 * History: Item 7e (2026-08-21 front-door audit) removed a "Near {Country}"
 * synthesis from this exact function for two independent reasons: (1) the
 * prefill was PASSIVE — nothing marked "Near Canada" as a guess rather than
 * a typed value, so it read as a choice the searcher never made; (2) it's a
 * bare country name in a field whose own placeholder promises "City, state,
 * or remote" — a country is not a locality. The "(detected)" suffix below
 * answers (1): the label can no longer be mistaken for an explicit choice.
 * It does NOT answer (2), and isn't claimed to — closing that would need the
 * server to resolve a locality, and `resolveLocationDefault`
 * (lib/geo/ip-default.ts) has no city/state path today, only country. (2) is
 * knowingly accepted rather than closed, because the 2026-09-10 bug was the
 * default applying server-side with the disclosure missing everywhere on
 * the pristine mobile landing — a labeled country-level guess was judged the
 * better failure mode than a silent one. An explicit selection (a place, or
 * remote-only) still always wins and is never itself mistaken for
 * "detected".
 */
import { LOCATION_FACET_FIELDS, isRemoteWorkTypeValue } from "./meilisearch";
import { locationDefaultScope, shouldShowLocationDefaultChip } from "./location-default-preference";
import type { FilterState } from "@/components/jobs/FilterPanel";

export const LOCATION_TRIGGER_PLACEHOLDER = "City, state, or remote";

/** Same "Near {region}[ or remote] (detected)" copy the location sheet's own
 *  detected-label uses (LocationPickerSheet via jobs/page.tsx) — the ONE
 *  formatter both surfaces call so the wording can't drift into a third
 *  variant of the same disclosure. `remoteAnywhere` derives the scope from
 *  the actual applied filter (`locationDefaultScope`, same as the toolbar
 *  chip) rather than always naming the bare country. */
export function detectedLocationLabel(iso2: string, remoteAnywhere: boolean | undefined): string {
    return `Near ${locationDefaultScope(iso2, remoteAnywhere)} (detected)`;
}

export function locationTriggerLabel(
    state: FilterState,
    defaultedLocation?: string | null,
    remoteAnywhere?: boolean,
): string {
    // Every location field, not only `location_country`: a city picked from
    // a suggestion lands in `location_city`, and the phone's field showed the
    // empty placeholder over results filtered to that city.
    const values = LOCATION_FACET_FIELDS.flatMap((field) => state.facets[field] ?? [])
        .map((v) => v.trim())
        .filter(Boolean);
    if (values.length === 1) return values[0]!;
    if (values.length > 1) {
        // A trigger is one line of a narrow control, so past the first place it
        // reports a COUNT rather than truncating a list — "Montréal +2" says how
        // much is hidden, where "Montréal, Toron…" only says that something is.
        // The chips row below spells all of them out and can remove any one.
        return `${values[0]} +${values.length - 1}`;
    }

    // The SAME predicate the toolbar's DefaultLocationChip gates on
    // (`shouldShowLocationDefaultChip`, location-default-preference.ts) — the
    // one chokepoint for "is the geo default still in effect," shared so the
    // chip and this trigger can never disagree about it by construction
    // (PR #461 review BLOCKER: they used to each keep their own check).
    //
    // It deliberately has no `work_type`/remote check, because the server's
    // own gate doesn't either: `hasLocationSignal` (lib/geo/ip-default.ts)
    // only looks at `suppressLocationDefault`/`places`/location facets,
    // so picking "Remote" does NOT suppress the default server-side —
    // `buildFilter` (lib/jobs/meilisearch.ts) ANDs the `work_type = remote`
    // clause with the detected country's `places` clause, so results really
    // are still geo-scoped. Hiding the disclosure here once remote is picked
    // would misreport that active narrowing as absent.
    const chosenLocations = LOCATION_FACET_FIELDS.flatMap((field) => state.facets[field] ?? []);
    const defaultInEffect = shouldShowLocationDefaultChip(defaultedLocation, chosenLocations);

    // Same "Remote" copy the mobile Remote chip always shows
    // (FilterChipsRow.tsx) — an explicit remote-only pick is still a choice
    // the searcher made, so it's never itself relabeled as "detected"; it's
    // combined with the disclosure (not replaced by it) when the default is
    // also in effect, per the server-truth note above.
    if ((state.facets.work_type ?? []).some(isRemoteWorkTypeValue)) {
        // "Remote" already leads the label, so the country half never adds
        // its own "or remote" — that would just repeat what "Remote" already
        // said (`false`, not `remoteAnywhere`: this branch's own explicit
        // pick, not the geo default's bypass, is what's disclosed here).
        return defaultInEffect ? `Remote · ${detectedLocationLabel(defaultedLocation!, false)}` : "Remote";
    }

    if (defaultInEffect) return detectedLocationLabel(defaultedLocation!, remoteAnywhere);

    return LOCATION_TRIGGER_PLACEHOLDER;
}
