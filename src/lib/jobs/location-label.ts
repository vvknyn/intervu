/**
 * Label for the mobile location trigger from committed filter state, plus
 * (2026-09-10, "auto location detect is not working" bug) the applied
 * IP-geo default when the searcher hasn't chosen anything of their own.
 *
 * Pure module (no React/DOM) so it's importable from `node:test` directly —
 * split out of FilterPanel.tsx, which pulls in React/JSX and can't be
 * required standalone under the test runner.
 *
 * History: Item 7e (2026-08-21 front-door audit) removed a "Near {Country}"
 * synthesis from this exact function — live prod showed "Near Canada"
 * PASSIVELY prefilled into a field promising "City, state, or remote", with
 * nothing marking it as a guess rather than a typed value. This reintroduces
 * disclosure, but not the same bug: the label now always carries the word
 * "detected" when it's showing the server's guess, so it can never be
 * mistaken for an explicit choice the searcher never made — the exact gap
 * the 2026-08-21 audit objected to. An explicit selection (a place, or
 * remote-only) still always wins and never shows "detected".
 */
import { LOCATION_FACET_FIELDS, isRemoteWorkTypeValue } from "./meilisearch";
import { regionDisplayName } from "./location-default-preference";
import type { FilterState } from "@/components/jobs/FilterPanel";

export const LOCATION_TRIGGER_PLACEHOLDER = "City, state, or remote";

/** True when some OTHER location facet (city/state) already carries an
 *  explicit value — e.g. a deep link into a specific city — independent of
 *  the `location_country` field this trigger otherwise displays. Matches
 *  `chosenLocations`'s own span of fields (jobs/page.tsx), the single
 *  existing source of truth for "has the searcher picked a place at all". */
function hasNonCountryPlacePick(state: FilterState): boolean {
    return LOCATION_FACET_FIELDS.some(
        (field) => field !== "location_country" && (state.facets[field] ?? []).some((v) => v.trim().length > 0),
    );
}

export function locationTriggerLabel(state: FilterState, defaultedLocation?: string | null): string {
    const values = (state.facets.location_country ?? []).map((v) => v.trim()).filter(Boolean);
    if (values.length === 1) return values[0]!;
    if (values.length > 1) {
        // A trigger is one line of a narrow control, so past the first place it
        // reports a COUNT rather than truncating a list — "Montréal +2" says how
        // much is hidden, where "Montréal, Toron…" only says that something is.
        // The chips row below spells all of them out and can remove any one.
        return `${values[0]} +${values.length - 1}`;
    }

    // Same "Remote" copy the mobile Remote chip always shows
    // (FilterChipsRow.tsx) — an explicit remote-only pick, like an explicit
    // place, is a choice the searcher made and must never be overwritten by
    // the passive geo default below.
    if ((state.facets.work_type ?? []).some(isRemoteWorkTypeValue)) return "Remote";

    if (!hasNonCountryPlacePick(state) && defaultedLocation) {
        return `Near ${regionDisplayName(defaultedLocation)} · detected`;
    }

    return LOCATION_TRIGGER_PLACEHOLDER;
}
