/**
 * Where postings' descriptions say the person must be (`readPlaceRestriction`),
 * for rows whose title and place fields name no country of their own, or
 * several the title does not narrow (`needsPlaceCheck`).
 * Server-only: it reads descriptions the list rows don't carry
 * (`JOB_LIST_ATTRIBUTES_TO_RETRIEVE` leaves them out for speed) and resolves
 * cities with the gazetteer, then sends back only the place, never the text.
 *
 * Every search reads its page's rows here (`withPlaceRestrictions`, called by
 * `searchJobsAction`), so every list, the For you deck and Today label a role
 * for people in another country the same way its own page does
 * (`withDescriptionPlace`). `/api/jobs/place-notes` (`readPlaceNotes`) is the
 * browser's fallback for rows a slow read left unread.
 */
import { loadGazetteer, type Gazetteer } from "@/lib/geo/gazetteer";
import { readLocationCountry } from "@/lib/geo/location-country";
import { descriptionNeedsFill } from "./fill-description";
import { buildJobSearchUrl } from "./get-job";
import { host, meiliFetch, searchKey } from "./meilisearch";
import { needsPlaceCheck, PLACE_NOTES_MAX_IDS, readPlaceRestriction, type ResolvePlace } from "./place-restriction";
import { resumeCountriesFromLocation } from "./resume-location";
import type { PlaceRestriction, PublicJob } from "./types";

/** How long a search waits for its rows' description places before it answers without them. */
export const SEARCH_PLACE_READ_DEADLINE_MS = 250;
/** The most rows one search reads descriptions for (the hub's deepest count probe is 120). */
export const SEARCH_PLACE_READ_MAX_IDS = 120;

/** A city or region name to the canonical country it clearly sits in ("Bengaluru" → India; "Cambridge" → none). */
export function gazetteerPlace(gazetteer: Gazetteer): ResolvePlace {
    return (phrase) => {
        const { paired, named } = readLocationCountry(phrase, gazetteer);
        const iso2 = paired ?? named;
        const name = iso2 ? gazetteer.countriesByIso2.get(iso2)?.name : null;
        return name ? (resumeCountriesFromLocation(name)[0] ?? null) : null;
    };
}

/** One description's place, with cities read through the gazetteer. */
function descriptionPlace(description: string | null | undefined): PlaceRestriction | null {
    return readPlaceRestriction(description, gazetteerPlace(loadGazetteer()));
}

/**
 * Places already read, by job id. A full description rarely changes, so a
 * row the hub's count probes and the list both show is read once; a teaser
 * stub (`descriptionNeedsFill`) is never kept, as its full text may follow.
 */
const PLACE_CACHE_MAX = 20_000;
const PLACE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const placeCache = new Map<string, { place: PlaceRestriction | null; at: number }>();

function cachedPlace(id: string, now: number): PlaceRestriction | null | undefined {
    const hit = placeCache.get(id);
    if (!hit) return undefined;
    if (now - hit.at > PLACE_CACHE_TTL_MS) {
        placeCache.delete(id);
        return undefined;
    }
    return hit.place;
}

function keepPlace(id: string, place: PlaceRestriction | null, now: number) {
    placeCache.delete(id);
    placeCache.set(id, { place, at: now });
    if (placeCache.size > PLACE_CACHE_MAX) placeCache.delete(placeCache.keys().next().value!);
}

/**
 * Each id's description place, or `null` when it states none. An id the index
 * doesn't hold is left out. With `signal`, one attempt that stops when the
 * signal aborts (`withPlaceRestrictions` stops late reads past its cap).
 */
export async function readDescriptionPlaces(ids: string[], signal?: AbortSignal): Promise<Record<string, PlaceRestriction | null>> {
    const now = Date.now();
    const notes: Record<string, PlaceRestriction | null> = {};
    const unread: string[] = [];
    for (const id of new Set(ids)) {
        const cached = cachedPlace(id, now);
        if (cached === undefined) unread.push(id);
        else notes[id] = cached;
    }
    const h = host();
    if (unread.length === 0 || !h) return notes;

    const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        body: JSON.stringify({
            q: "",
            filter: `id IN [${unread.map((id) => JSON.stringify(id)).join(", ")}]`,
            limit: unread.length,
            attributesToRetrieve: ["id", "description"],
        }),
        cache: "no-store",
    };
    const url = buildJobSearchUrl(h);
    const res = signal ? await fetch(url, { ...init, signal }) : await meiliFetch(url, init);
    if (!res.ok) throw new Error(`meili place notes read failed: ${res.status}`);
    const body = (await res.json()) as { hits?: { id: string; description?: string | null }[] };
    for (const hit of body.hits ?? []) {
        notes[hit.id] = descriptionPlace(hit.description);
        if (!descriptionNeedsFill(hit.description)) keepPlace(hit.id, notes[hit.id]!, now);
    }
    return notes;
}

/** `/api/jobs/place-notes`: the browser's read for a few rows it shows. */
export function readPlaceNotes(ids: string[]): Promise<Record<string, PlaceRestriction | null>> {
    return readDescriptionPlaces([...new Set(ids)].slice(0, PLACE_NOTES_MAX_IDS));
}

/**
 * How many reads that missed a search's deadline may keep running, server-wide.
 * A late read still fills the cache, so the next search for those rows is
 * warm; past this many, a late read is stopped so a slow Meili gets no more
 * load from it.
 */
export const MAX_LATE_PLACE_READS = 2;
let latePlaceReads = 0;

/**
 * A search's rows, each row that names no place of its own carrying what its
 * description says (`place_restriction`: a place, or `null` for none). One
 * read for the page, bounded by `deadlineMs`: on a slow or failed read the
 * rows come back as they were, and the browser reads the ones it shows.
 */
export async function withPlaceRestrictions<T extends PublicJob>(
    hits: T[],
    {
        read = readDescriptionPlaces,
        deadlineMs = SEARCH_PLACE_READ_DEADLINE_MS,
    }: { read?: (ids: string[], signal: AbortSignal) => Promise<Record<string, PlaceRestriction | null>>; deadlineMs?: number } = {},
): Promise<T[]> {
    const ids = hits
        .filter(needsPlaceCheck)
        .slice(0, SEARCH_PLACE_READ_MAX_IDS)
        .map((hit) => hit.id);
    if (ids.length === 0) return hits;
    const controller = new AbortController();
    const reading = read(ids, controller.signal).catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            resolve(null);
            if (latePlaceReads >= MAX_LATE_PLACE_READS) {
                controller.abort();
                return;
            }
            latePlaceReads += 1;
            void reading.finally(() => {
                latePlaceReads -= 1;
            });
        }, deadlineMs);
    });
    const notes = await Promise.race([reading, late]).finally(() => clearTimeout(timer));
    if (!notes) return hits;
    const asked = new Set(ids);
    return hits.map((hit) => (asked.has(hit.id) ? { ...hit, place_restriction: notes[hit.id] ?? null } : hit));
}

/**
 * A whole job (its description included) with the place that description
 * limits it to, for a page that scores it whole, so the job page reads a role
 * for people in India as abroad just as the lists do. A job without its
 * description, or one already read, is returned as it is.
 */
export function withDescriptionPlace(job: PublicJob): PublicJob {
    if (job.place_restriction !== undefined || typeof job.description !== "string") return job;
    return { ...job, place_restriction: descriptionPlace(job.description) };
}
