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
import { locationDefaultScope } from "./location-default-preference";

/** Same "Near {region}[ or remote] (detected)" copy the location sheet's own
 *  detected-label uses — the ONE formatter, so the wording can't drift. `remoteAnywhere` derives the scope from
 *  the actual applied filter (`locationDefaultScope`, same as the toolbar
 *  chip) rather than always naming the bare country. */
export function detectedLocationLabel(iso2: string, remoteAnywhere: boolean | undefined): string {
    return `Near ${locationDefaultScope(iso2, remoteAnywhere)} (detected)`;
}
