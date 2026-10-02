/**
 * Résumé location → search facet hints (country only).
 *
 * Isomorphic, no I/O, no gazetteer — safe under `tsx` unit tests.
 * City is intentionally never emitted (Richmond Hill, Ontario vs
 * Richmond Hill, Georgia collision).
 */
import { regionLabel, resolveRegionPhrase } from "@/lib/geo/regions";
import { classifyCountryValue } from "./country-classification";
import type { PublicJob } from "./types";

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

/**
 * Whole comma-token codes: "ON" → Canada, "TX" → United States, "CAN" → Canada.
 * Only codes that are not also an ISO country code are used ("Berlin, DE",
 * "Amsterdam, NL", "Boston, MA" stay unresolved rather than guessed), and
 * `CA` is Canada only beside a Canadian province code.
 */
const CA_PROVINCE_CODES = new Set(["ab", "bc", "mb", "nb", "ns", "nt", "nu", "on", "qc", "yt"]);
const US_STATE_CODES = new Set(
    "ak ct fl hi ia ks mi nd nh nj nm nv ny oh ok or ri tx ut vt wa wi wv wy".split(" "),
);
const COUNTRY_CODE_TOKENS: Record<string, string> = { can: "Canada", usa: "United States", us: "United States" };

function countriesFromCodeTokens(tokens: string[]): string[] {
    const codes = tokens.map((token) => token.trim().toLowerCase());
    const out = new Set<string>();
    for (const code of codes) {
        if (COUNTRY_CODE_TOKENS[code]) out.add(COUNTRY_CODE_TOKENS[code]);
        else if (CA_PROVINCE_CODES.has(code)) out.add("Canada");
        else if (US_STATE_CODES.has(code)) out.add("United States");
    }
    if (out.has("Canada") && codes.includes("ca")) out.add("Canada");
    return [...out];
}

/** Whole-word matchers: `bc`/`dc`/`pei` must not fire inside another word. Job place strings run through this too. */
const REGION_MATCHERS: Array<[RegExp, string]> = Object.entries(REGION_TO_COUNTRY).map(([region, country]) => [
    new RegExp(`\\b${region}\\b`),
    country,
]);

const PLACE_SEPARATOR = /[,;|·•/]|\s[-–]\s/;

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
    const parts = raw.split(PLACE_SEPARATOR);
    for (const part of parts) {
        const country = canonicalCountry(part);
        if (country) countries.add(country);
    }
    for (const country of countriesFromCodeTokens(parts)) countries.add(country);
    const whole = canonicalCountry(raw);
    if (whole) countries.add(whole);

    // Province / state / region → country (e.g. Ontario → Canada).
    const lower = raw.toLowerCase();
    for (const [matcher, country] of REGION_MATCHERS) {
        if (matcher.test(lower)) countries.add(country);
    }

    if (countries.size === 0) return {};
    return { location_country: [...countries].sort() };
}

/** Canonical country names inferred from a résumé location string. */
export function resumeCountriesFromLocation(location: string | null | undefined): string[] {
    return deriveResumeLocationFacets(location).location_country ?? [];
}

/** Countries a job is in: its `location_country` values, else what its place text names ("Remote (US only)", "Remote - EMEA"). */
export function jobCountries(job: PublicJob): string[] {
    const raw = job.location_country;
    const values = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const tagged = new Set<string>();
    for (const value of values) {
        const country = canonicalCountry(value ?? "");
        if (country) tagged.add(country);
    }
    if (tagged.size > 0) return [...tagged];
    const fields = [job.location, job.location_city, job.location_state];
    const named = new Set(fields.flatMap(resumeCountriesFromLocation));
    if (named.size > 0) return [...named];
    for (const field of fields) {
        for (const piece of (field ?? "").split(PLACE_PIECE_SEPARATOR)) {
            for (const country of placeNamed(piece)?.countries ?? []) named.add(country);
        }
    }
    return [...named];
}

/** Where a title or place field breaks into pieces: "TAM (Remote - India)", "Remote, US only", "Engineer | EMEA". */
const PLACE_PIECE_SEPARATOR = /\s[-–—|]\s|[(),/|;]/;

/** Words around a place that say how a posting relates to it, not which place it is: "Remote, US only", "anywhere in the UK". */
const PLACE_LEAD_WORDS = new Set([
    "remote", "remotely", "fully", "100%", "hybrid", "onsite", "on-site", "in-office", "wfh", "anywhere",
    "based", "located", "within", "in", "across", "throughout", "the", "only", "open", "to", "candidates",
    "applicants", "residents", "from",
]);
const PLACE_TRAIL_WORDS = new Set(["remote", "only", "based", "preferred", "residents", "candidates", "applicants", "hybrid", "onsite", "on-site"]);

/**
 * The one place a short phrase names once the words about working there are
 * set aside: "US only", "India-based", "Remote India", "anywhere in the UK",
 * "EMEA", "Ontario". `null` for anything else, including time zones ("US
 * time zones" asks for working hours, not a country) and phrases that only
 * contain a place among other words.
 */
export function placeNamed(text: string | null | undefined): { label: string; countries: string[] } | null {
    const words = (text ?? "")
        .replace(/[-–](based|only)\b/gi, " $1")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (words.some((word) => /^(?:time|timezones?|hours|tz)$/i.test(word))) return null;
    while (words.length > 0 && PLACE_LEAD_WORDS.has(words[0]!.toLowerCase())) words.shift();
    while (words.length > 0 && PLACE_TRAIL_WORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
    const phrase = words.join(" ");
    if (!phrase) return null;
    const members = resolveRegionPhrase(phrase);
    if (members && REGION_NAMES) {
        const countries = [
            ...new Set(members.map((iso2) => canonicalCountry(REGION_NAMES.of(iso2) ?? "")).filter((c): c is string => Boolean(c))),
        ];
        if (countries.length > 0) return { label: regionLabel(phrase) ?? phrase, countries };
    }
    const named = resumeCountriesFromLocation(phrase);
    return named.length > 0 ? { label: named.join(", "), countries: named } : null;
}

/** ISO2 → English country name, for turning a region's members into canonical country names. */
const REGION_NAMES =
    typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/**
 * The place a posting's TITLE names after the role, for a posting whose place
 * fields name none: "Technical Account Manager - Europe", "TAM (DACH)",
 * "Account Manager, UK". A remote posting with no country used to read as
 * "open to any location", so a Europe-only role scored as a same-country fit
 * for a Toronto résumé. The first piece is the role itself and is never read.
 */
export function titlePlace(title: string | null | undefined): { label: string; countries: string[] } | null {
    const pieces = (title ?? "")
        .split(PLACE_PIECE_SEPARATOR)
        .map((piece) => piece.trim())
        .filter(Boolean)
        .slice(1);
    for (const piece of pieces) {
        const named = placeNamed(piece);
        if (named) return named;
    }
    return null;
}
