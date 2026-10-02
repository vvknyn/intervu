/**
 * Where each of a few postings' descriptions says the person must be
 * (`readPlaceRestriction`), for ranked lists whose rows name no country of
 * their own. Server-only: it reads descriptions the list rows don't carry
 * (`JOB_LIST_ATTRIBUTES_TO_RETRIEVE` leaves them out for speed) and resolves
 * cities with the gazetteer, then sends back only the place, never the text.
 */
import { loadGazetteer, type Gazetteer } from "@/lib/geo/gazetteer";
import { readLocationCountry } from "@/lib/geo/location-country";
import { buildJobSearchUrl } from "./get-job";
import { host, meiliFetch, searchKey } from "./meilisearch";
import { PLACE_NOTES_MAX_IDS, readPlaceRestriction, type ResolvePlace } from "./place-restriction";
import { resumeCountriesFromLocation } from "./resume-location";
import type { PlaceRestriction } from "./types";

/** A city or region name to the canonical country it clearly sits in ("Bengaluru" → India; "Cambridge" → none). */
export function gazetteerPlace(gazetteer: Gazetteer): ResolvePlace {
    return (phrase) => {
        const { paired, named } = readLocationCountry(phrase, gazetteer);
        const iso2 = paired ?? named;
        const name = iso2 ? gazetteer.countriesByIso2.get(iso2)?.name : null;
        return name ? (resumeCountriesFromLocation(name)[0] ?? null) : null;
    };
}

/** Each id's description limit, or `null` when it states none. An id the index doesn't hold is left out. */
export async function readPlaceNotes(ids: string[]): Promise<Record<string, PlaceRestriction | null>> {
    const wanted = [...new Set(ids)].slice(0, PLACE_NOTES_MAX_IDS);
    const h = host();
    if (wanted.length === 0 || !h) return {};

    const res = await meiliFetch(buildJobSearchUrl(h), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        body: JSON.stringify({
            q: "",
            filter: `id IN [${wanted.map((id) => JSON.stringify(id)).join(", ")}]`,
            limit: wanted.length,
            attributesToRetrieve: ["id", "description"],
        }),
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`meili place notes read failed: ${res.status}`);
    const body = (await res.json()) as { hits?: { id: string; description?: string | null }[] };
    const resolvePlace = gazetteerPlace(loadGazetteer());
    const notes: Record<string, PlaceRestriction | null> = {};
    for (const hit of body.hits ?? []) notes[hit.id] = readPlaceRestriction(hit.description, resolvePlace);
    return notes;
}
