/**
 * Résumé location → search facet hints (country only).
 *
 * Isomorphic, no I/O, no gazetteer — safe under `tsx` unit tests.
 * City is intentionally never emitted (Richmond Hill, Ontario vs
 * Richmond Hill, Georgia collision).
 */
import { classifyCountryValue } from "./country-classification";

export type ResumeLocationFacets = {
    location_country?: string[];
};

/** Canadian provinces / territories → canonical country facet value. */
const CA_PROVINCE_TO_COUNTRY: Record<string, string> = {
    alberta: "Canada",
    "british columbia": "Canada",
    bc: "Canada",
    manitoba: "Canada",
    "new brunswick": "Canada",
    "newfoundland and labrador": "Canada",
    "northwest territories": "Canada",
    "nova scotia": "Canada",
    nunavut: "Canada",
    ontario: "Canada",
    "prince edward island": "Canada",
    pei: "Canada",
    quebec: "Canada",
    saskatchewan: "Canada",
    yukon: "Canada",
};

/** Common US state / territory names → canonical country facet value. */
const US_STATE_TO_COUNTRY: Record<string, string> = {
    alabama: "United States",
    alaska: "United States",
    arizona: "United States",
    arkansas: "United States",
    california: "United States",
    colorado: "United States",
    connecticut: "United States",
    delaware: "United States",
    florida: "United States",
    georgia: "United States",
    hawaii: "United States",
    idaho: "United States",
    illinois: "United States",
    indiana: "United States",
    iowa: "United States",
    kansas: "United States",
    kentucky: "United States",
    louisiana: "United States",
    maine: "United States",
    maryland: "United States",
    massachusetts: "United States",
    michigan: "United States",
    minnesota: "United States",
    mississippi: "United States",
    missouri: "United States",
    montana: "United States",
    nebraska: "United States",
    nevada: "United States",
    "new hampshire": "United States",
    "new jersey": "United States",
    "new mexico": "United States",
    "new york": "United States",
    "north carolina": "United States",
    "north dakota": "United States",
    ohio: "United States",
    oklahoma: "United States",
    oregon: "United States",
    pennsylvania: "United States",
    "rhode island": "United States",
    "south carolina": "United States",
    "south dakota": "United States",
    tennessee: "United States",
    texas: "United States",
    utah: "United States",
    vermont: "United States",
    virginia: "United States",
    washington: "United States",
    "west virginia": "United States",
    wisconsin: "United States",
    wyoming: "United States",
    "district of columbia": "United States",
    dc: "United States",
};

/** UK constituent nations / common region labels → canonical country. */
const UK_REGION_TO_COUNTRY: Record<string, string> = {
    england: "United Kingdom",
    scotland: "United Kingdom",
    wales: "United Kingdom",
    "northern ireland": "United Kingdom",
};

const REGION_TO_COUNTRY: Record<string, string> = {
    ...CA_PROVINCE_TO_COUNTRY,
    ...US_STATE_TO_COUNTRY,
    ...UK_REGION_TO_COUNTRY,
};

function canonicalCountry(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const classified = classifyCountryValue(trimmed);
    return classified.kind === "country" ? classified.canonical : null;
}

/**
 * Derive country-only location facets from a résumé location string.
 * Returns `{}` when the string is empty or no country can be inferred.
 */
export function deriveResumeLocationFacets(location: string | null | undefined): ResumeLocationFacets {
    const raw = (location ?? "").trim();
    if (!raw) return {};

    const countries = new Set<string>();

    // Explicit country names anywhere in the string (e.g. "Toronto, Canada").
    for (const part of raw.split(/[,;|·•/]/)) {
        const country = canonicalCountry(part);
        if (country) countries.add(country);
    }
    const whole = canonicalCountry(raw);
    if (whole) countries.add(whole);

    // Province / state / region → country (e.g. Ontario → Canada).
    const lower = raw.toLowerCase();
    for (const [region, country] of Object.entries(REGION_TO_COUNTRY)) {
        if (lower.includes(region)) countries.add(country);
    }

    if (countries.size === 0) return {};
    return { location_country: [...countries].sort() };
}

/** Canonical country names inferred from a résumé location string. */
export function resumeCountriesFromLocation(location: string | null | undefined): string[] {
    return deriveResumeLocationFacets(location).location_country ?? [];
}
