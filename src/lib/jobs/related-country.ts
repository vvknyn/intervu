/**
 * The country "More like this" keeps similar roles in. Server-only: reading
 * a job's location text needs the place resolver, which the client
 * components importing related-jobs.ts must not bundle.
 */

import type { Gazetteer } from "@/lib/geo/gazetteer";
import { readLocationCountry } from "@/lib/geo/location-country";
import type { RelatedSeed } from "@/lib/jobs/related-jobs";

/** The one country an admin1 name ("California", "Ontario") belongs to, or
 *  null when the name is unknown or shared across countries. */
function admin1Country(name: string, gazetteer: Gazetteer): string | null {
    const countries = new Set((gazetteer.admin1ByName.get(name.toLowerCase()) ?? []).map((a) => a.countryCode));
    return countries.size === 1 ? [...countries][0]! : null;
}

/**
 * The ISO2 country to keep similar roles in, or null to search everywhere.
 *
 * 1. A place in the location text beside the state or country it sits in
 *    ("CA, Oakville 1, Office": Canada has an Oakville, California has
 *    none). It outranks the country field: that job listed US roles, so its
 *    field most likely read the same "CA" as California (2026-09-30).
 * 2. The country field, read as a country: a two-letter value is a country
 *    code, so "CA" is Canada. Passed through the search box's place parser
 *    it was California, and a Canadian job listed US roles (2026-09-30).
 * 3. The state field ("CALIFORNIA") when it names a state of exactly one
 *    country.
 * 4. Whatever country the location text clearly names on its own: "NYC
 *    Office", "Utah County Administration Building" and "Manchester" all
 *    searched the whole world, or Jamaica, before (2026-09-30).
 */
export function relatedCountryIso2(seed: Pick<RelatedSeed, "country" | "state" | "location">, gazetteer: Gazetteer): string | null {
    const text = readLocationCountry(seed.location, gazetteer);
    if (text.paired) return text.paired;
    const country = seed.country?.trim();
    if (country) {
        const hit =
            country.length === 2
                ? gazetteer.countriesByIso2.get(country.toUpperCase())
                : country.length === 3
                  ? gazetteer.countriesByIso3.get(country.toUpperCase())
                  : gazetteer.countriesByName.get(country.toLowerCase());
        if (hit) return hit.iso2;
    }
    const state = seed.state?.trim();
    if (state && state.length > 2) {
        const iso2 = admin1Country(state, gazetteer);
        if (iso2) return iso2;
    }
    return text.named;
}
