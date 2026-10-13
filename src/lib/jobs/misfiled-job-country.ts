/**
 * A row whose tagged country contradicts its own place text, read back to the
 * country it is really in. Server only (the gazetteer is a 4 MB table).
 *
 * Found in the review of 2026-10-13: the upstream feed reads a foreign country
 * code as a Canadian province code — "NL" (the Netherlands) as Newfoundland and
 * Labrador, "PE" as Prince Edward Island — so Dutch government postings
 * ("Den Haag, NL, 2511 CB") and a Kraków role ("Kraków PE; Warszawa") arrived
 * tagged `location_country: Canada` and sat in Canadian candidates' packs as
 * workable roles. The search filter can't tell (it trusts the tag); the fit
 * score can, once the row says where it really is: it then reads "Outside
 * Canada", ranks after every role they can take, and Today leaves it out.
 *
 * Conservative by construction — a row is only re-read when ALL of:
 *  - its place text pairs the "NL" code with a Dutch postal code ("2511 CB"),
 *    or otherwise names one other country (`readLocationCountry`: a city or
 *    region with its country, or a country name/code); and
 *  - its city is not a city of the tagged country (so "London, ON",
 *    "St. John's, NL" and "Halifax, NS" stay Canadian).
 * Anything less keeps the tag as it is.
 */
import type { Gazetteer } from "@/lib/geo/gazetteer";
import { readLocationCountry } from "@/lib/geo/location-country";
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";
import type { PublicJob } from "@/lib/jobs/types";

/** A Dutch postal code ("2511 CB", "3584AB"); Canadian codes are letter-digit-letter ("A2H 6J3"). */
const DUTCH_POSTAL = /\b\d{4}\s?[A-Z]{2}\b/;
const NL_CODE = /(^|[\s,;(])NL([\s,;)]|$)/;

function norm(s: string): string {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** The tagged country's ISO2, when the row carries exactly one tag the gazetteer knows. */
function taggedIso2(job: PublicJob, gazetteer: Gazetteer): string | null {
    const raw = job.location_country;
    const values = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    if (values.length !== 1) return null;
    const value = (values[0] ?? "").trim();
    const byName = gazetteer.countriesByName.get(value.toLowerCase()) ?? gazetteer.countriesByName.get(norm(value));
    if (byName) return byName.iso2;
    const canonical = resumeCountriesFromLocation(value)[0];
    if (!canonical) return null;
    return gazetteer.countriesByName.get(canonical.toLowerCase())?.iso2 ?? null;
}

/** Is `city` (the row's own city field, or the first piece of its place text) a city of `iso2`? */
function cityIn(job: PublicJob, iso2: string, gazetteer: Gazetteer): boolean {
    const city = (job.location_city ?? (job.location ?? "").split(/[,;]/)[0] ?? "").replace(/\s*[-(].*$/, "");
    const key = norm(city);
    if (!key) return false;
    const rows = gazetteer.citiesByName.get(key) ?? gazetteer.citiesByName.get(city.toLowerCase().trim()) ?? [];
    return rows.some((row) => row.countryCode === iso2);
}

/** The country the row's place text says it is in, when that contradicts its tag; `null` to keep the tag. */
export function misfiledCountry(job: PublicJob, gazetteer: Gazetteer): string | null {
    const tagged = taggedIso2(job, gazetteer);
    if (!tagged) return null;
    const text = [job.location, job.location_city, job.location_state].filter(Boolean).join(", ");
    if (!text) return null;
    if (cityIn(job, tagged, gazetteer)) return null;
    // "NL" beside a Dutch postal code is the Netherlands, never Newfoundland and Labrador
    // (whose codes read "A1C 5S7"); checked first, since the gazetteer reads "NL" as that province.
    let read: string | null = NL_CODE.test(text) && DUTCH_POSTAL.test(job.location ?? "") ? "NL" : null;
    if (!read) {
        const { paired, named } = readLocationCountry(text, gazetteer);
        read = paired ?? named;
    }
    if (!read || read === tagged) return null;
    const name = gazetteer.countriesByIso2.get(read)?.name;
    return name ? (resumeCountriesFromLocation(name)[0] ?? null) : null;
}

/** `job` with its country read back from its place text when the tag contradicts it (`misfiledCountry`). */
export function withCorrectedCountry<T extends PublicJob>(job: T, gazetteer: Gazetteer): T {
    const country = misfiledCountry(job, gazetteer);
    return country ? { ...job, location_country: country } : job;
}
