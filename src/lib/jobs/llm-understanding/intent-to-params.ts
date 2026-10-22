import type { FacetKey, JobSearchParams, PlaceClause } from "../types";
import { POSTED_BUCKETS, YEARS_BUCKETS, YEARS_TOP_BUCKET, bucketFor } from "../query-tokens/buckets";
import type { JobSearchIntent } from "./schema";

const quote = (t: string) => `"${t.replace(/"/g, "")}"`;

/**
 * The residual query text the intent implies. Several titles go out in the
 * quoted-OR form packs send; their must-have terms cannot ride along (that
 * form is exact titles only), so the caller mentions them instead.
 */
function buildQuery({ titles, terms }: JobSearchIntent): { q: string; leftover: string[] } {
    return titles.length > 1
        ? { q: titles.map(quote).join(" OR "), leftover: terms }
        : { q: [...titles, ...terms].join(" "), leftover: [] };
}

/**
 * Pure: write what the LLM understood into `JobSearchParams`. Same two rules as
 * `applyQueryUnderstanding`: an explicit selection already on `p` always wins,
 * and anything not mapped lands in `unmatchedQueryMentions`, never dropped.
 * `places` is the intent's location already resolved against the corpus (async,
 * so done by the caller); an empty list means it named nothing filterable.
 */
export function applyIntent(p: JobSearchParams, intent: JobSearchIntent, places: PlaceClause[] = []): JobSearchParams {
    const { q, leftover } = buildQuery(intent);
    // Seniority is never a filter (query-understanding.ts: the corpus's "mid" dump bucket would drop
    // correctly-titled roles) — it stays a mention; title-first ranking orders by it.
    const mentions = [
        ...leftover,
        ...intent.unparsed,
        ...intent.exclude_titles.map((t) => `not ${t}`),
        ...(intent.experience_level ? [`${intent.experience_level} level`] : []),
    ];
    const facets: JobSearchParams["facets"] = { ...p.facets };
    const setFacet = (key: FacetKey, value: string | null) => {
        if (value && !facets[key]?.length) facets[key] = [value];
    };
    setFacet("work_type", intent.work_mode);
    setFacet("employment_type", intent.employment_type);

    let postedBucket = p.postedBucket;
    const days = intent.posted_within_days;
    if (days !== null && !postedBucket) {
        postedBucket = bucketFor(days, POSTED_BUCKETS);
        if (!postedBucket) mentions.push(`posted within ${days} days`);
    }

    const { country, state, city } = intent.location;
    const named = [city, state, country].filter((x): x is string => Boolean(x));
    const placeSet = Boolean(p.places?.length || p.facets?.location_country?.length);
    if (named.length && !placeSet && !places.length) mentions.push(named.join(", "));

    const yearsExperience =
        p.yearsExperience ?? (intent.min_years === null ? undefined : bucketFor(intent.min_years, YEARS_BUCKETS, YEARS_TOP_BUCKET));

    return {
        ...p,
        q,
        facets,
        postedBucket,
        yearsExperience,
        salaryMin: p.salaryMin ?? intent.min_salary.amount ?? undefined,
        ...(named.length && !placeSet && places.length && { places }),
        unmatchedQueryMentions: [...new Set([...(p.unmatchedQueryMentions ?? []), ...mentions])],
    };
}
