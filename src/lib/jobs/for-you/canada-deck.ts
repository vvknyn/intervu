import { isCanadaJobContext } from "@/lib/jobs/trust-corrections";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * A breadcrumb segment that names Canada. `CAN` is the leak on raw ATS
 * strings (`CAN - ON - Toronto`) that never set `location_country`. `CA`
 * is intentionally absent: in a place string it is California.
 */
const CANADA_SEGMENT = /^(?:can|canada|canadian)$/i;

/**
 * Places that name Canada even when the country word is missing.
 * `CA` stays out: in a place string it is California.
 * Province codes are whole segments (`ON`, `BC`), not substrings.
 */
const CANADA_CITY = /\b(?:toronto|montréal|montreal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|brampton)\b/i;
const CANADA_PROVINCE =
    /^(?:ontario|british columbia|quebec|québec|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland(?: and labrador)?|prince edward island|pei|yukon|nunavut|northwest territories|on|bc|qc|ab|mb|sk|ns|nb|nl|pe|nt|nu|yt)$/i;

function mentionsCanadaPlace(value: string | null | undefined): boolean {
    if (!value) return false;
    if (CANADA_CITY.test(value)) return true;
    return segments(value).some((part) => CANADA_PROVINCE.test(part));
}

function segments(value: string | null | undefined): string[] {
    if (!value) return [];
    return value
        .split(/\s*,\s*|\s+-\s+|\s*\/\s*|\s*;\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
}

type CanadaDeckJob = Pick<
    PublicJob,
    "company" | "location" | "location_city" | "location_state" | "location_country"
>;

const CANADA_COUNTRY_FACET = /^(?:ca|can|canada|canadian)$/i;

/** Drop Canada from a résumé-derived country facet so the deck is not scoped to it. */
export function omitCanadaCountryFacet(facets: {
    location_country?: string[];
}): { location_country?: string[] } {
    const kept = (facets.location_country ?? []).filter((country) => !CANADA_COUNTRY_FACET.test(country.trim()));
    return kept.length > 0 ? { location_country: kept } : {};
}

/**
 * Signed-in deck exclusion. Reuses `isCanadaJobContext` (country field and
 * company suffix) and also drops raw location breadcrumbs that say Canada
 * without a country field.
 */
export function isCanadaDeckJob(job: CanadaDeckJob): boolean {
    if (isCanadaJobContext(job)) return true;
    const country = Array.isArray(job.location_country)
        ? job.location_country.join(" ")
        : job.location_country;
    return [job.location, job.location_city, job.location_state, country].some(
        (field) =>
            segments(field ?? undefined).some((part) => CANADA_SEGMENT.test(part)) ||
            mentionsCanadaPlace(field ?? undefined),
    );
}
