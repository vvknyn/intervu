/**
 * GET /api/jobs/locations?q=... — typeahead for the jobs location box:
 * which places does this corpus actually have, and how many postings each.
 *
 * A route handler for the same reason `/api/jobs/suggest` is one: Next
 * serializes a client's Server Action calls per request, so a per-keystroke
 * action queues behind whatever full search is already in flight. It also
 * carries a `Cache-Control` header, which a Server Action response cannot —
 * place names are shared across searchers and change only as slowly as the
 * corpus does, so this caches harder than the title typeahead.
 *
 * Rate-limited per-IP with its OWN store (`allowJobsLocationRequest`), per
 * `lib/shield/rate-limit.ts`'s rule that every chokepoint counts separately.
 *
 * Never surfaces a 5xx. `fetchFacetSearch` already returns null on any
 * backend failure, and a field that could not be asked is omitted rather
 * than reported as "no matches" — those are different claims, and rendering
 * the second when the first is true would tell a searcher a place does not
 * exist when we simply failed to look.
 */
import { NextResponse } from "next/server";
import { fetchFacetSearch, LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";
import {
    applyLabelPrefix,
    buildLocationSuggestions,
    buildWorkModeSuggestion,
    LOCATION_SUGGEST_FIELDS,
    planLocationQuery,
} from "@/lib/jobs/location-suggest";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowJobsLocationRequest } from "@/lib/shield/rate-limit";
import type { LocationQueryPlan, LocationSuggestGroup } from "@/lib/jobs/location-suggest";
import type { FacetHit } from "@/lib/geo/corpus-values";

export interface LocationSuggestResponse {
    groups: LocationSuggestGroup[];
}

const EMPTY: LocationSuggestResponse = { groups: [] };

/**
 * Pure: parse + cap the raw `q`. Mirrors `resolveSuggestQuery`'s posture
 * toward user-controlled text reaching a search call, with a tighter cap —
 * no place name approaches 100 characters, and the value is going into a
 * facet query, not a full-text one.
 */
export function resolveLocationQuery(raw: string | null): string {
    return (raw ?? "").trim().slice(0, 100);
}

/**
 * Bare work-mode query ("remote", no place left over): there is no place
 * text to facet-search, so the honest suggestion is the work mode itself —
 * see `planLocationQuery`'s `workModeOnly` branch. `field: "work_type"` with
 * an empty query browses that facet's own value counts (no place filter),
 * which is exactly "how many jobs are remote" and reuses the same
 * `fetchFacetSearch` every place row's count goes through.
 */
async function buildWorkModeGroups(workTypes: readonly string[]): Promise<LocationSuggestGroup[]> {
    const hits = await fetchFacetSearch("work_type", "").catch(() => null);
    const group = buildWorkModeSuggestion(workTypes, hits);
    return group ? [group] : [];
}

/**
 * Place query (with or without a bound work-mode filter): one facet-search
 * call per location field, concurrently — each is ~40ms against the box, so
 * three in series would put the typeahead over a perceptible 120ms.
 */
async function buildPlaceGroups(plan: LocationQueryPlan): Promise<LocationSuggestGroup[]> {
    const fields = LOCATION_SUGGEST_FIELDS.map((f) => f.field);
    const results = await Promise.all(
        fields.map((field) =>
            fetchFacetSearch(
                field as (typeof LOCATION_FACET_FIELDS)[number],
                plan.facetQuery,
                plan.filter,
            ).catch(() => null),
        ),
    );

    const hitsByField: Partial<Record<(typeof fields)[number], readonly FacetHit[]>> = {};
    results.forEach((hits, i) => {
        // null means "couldn't ask" — leave the field absent, don't record []
        if (hits) hitsByField[fields[i]] = hits;
    });

    return applyLabelPrefix(buildLocationSuggestions(hitsByField), plan.labelPrefix);
}

export async function GET(request: Request): Promise<NextResponse> {
    const q = resolveLocationQuery(new URL(request.url).searchParams.get("q"));
    if (!q) return NextResponse.json(EMPTY);

    const ip = await getClientIp();
    if (!allowJobsLocationRequest(ip)) {
        return NextResponse.json(EMPTY, { status: 429 });
    }

    // Work-mode words typed into this box ("remote can") are not part of any
    // place name, so searching the literal string only ever matches junk an
    // employer typed into their own location field. The plan splits them off
    // into a FILTER, using the same parser that `resolveLocationFacet` uses
    // when the value is committed — see `planLocationQuery`.
    const plan = planLocationQuery(q);

    const groups = plan.workModeOnly
        ? await buildWorkModeGroups(plan.workModeOnly)
        : await buildPlaceGroups(plan);

    return NextResponse.json(
        { groups } satisfies LocationSuggestResponse,
        { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } },
    );
}
