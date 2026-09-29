/**
 * "Broaden this search" — ONE ladder shared by the personal packs and the
 * manual `/jobs` zero/thin-results state, so both surfaces offer the same
 * options with the same counts. A rung is a single change to the CURRENT
 * filter state (independent of the others, so each count is exactly what
 * applying that one option returns), and a count comes from the same search
 * call the results use. Options that would add nothing are never shown; an
 * option whose count cannot be fetched is dropped, never guessed.
 */
import type { CandidateRelocation } from "@/lib/jobs/candidate-signals";
import { searchParamsFromUrlState } from "@/lib/jobs/search-payload";
import type { FacetKey, JobSearchParams, JobSearchResult, PostedBucket } from "@/lib/jobs/types";
import type { JobsUrlState } from "@/lib/jobs/url-state";

/** A result set smaller than this is "thin": the surface says so and offers the ladder. */
export const THIN_RESULTS_BELOW = 30;

export function isThinResults(total: number): boolean {
    return total < THIN_RESULTS_BELOW;
}

export type BroadenRungId = "remote_anywhere" | "relocation" | "remove_location" | "any_seniority" | "any_date";

export interface BroadenRung {
    id: BroadenRungId;
    label: string;
    next: JobsUrlState;
}

export interface BroadenOption extends BroadenRung {
    /** Total results after applying this one option. Always greater than the current total. */
    count: number;
}

export interface BroadenContext {
    /** Only what the candidate stated in preferences — never inferred. */
    relocation?: CandidateRelocation | null;
    /** Label of a location the search applied on its own (IP default) — not one the user chose. */
    autoLocationLabel?: string;
    /** The state's location is an eligibility filter (a For-you pack): every count reads a
     *  search that dropped it (`locationDropped`) as 0 roles there, never the unfiltered total. */
    locationRequired?: boolean;
}

/** "Any": the search's own sentinel for "no location filter" (it also stops the IP default re-applying). */
const ANY_LOCATION = ["any"];
const LOCATION_FACETS: readonly FacetKey[] = ["location_country", "location_city", "location_state"];

/** One step wider per window; the widest finite window widens to "any date". */
const WIDER_POSTED: Record<PostedBucket, PostedBucket | undefined> = {
    "1d": "3d",
    "3d": "7d",
    "7d": "30d",
    "30d": undefined,
    older: undefined,
};
const POSTED_LABEL: Record<PostedBucket, string> = {
    "1d": "Last 24 hours",
    "3d": "Last 3 days",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    older: "Older than 30 days",
};

const isNeutral = (v: string): boolean => ["any", "all"].includes(v.trim().toLowerCase());
const fold = (v: string): string => v.trim().toLowerCase();

/** What a search result says about the location text it could not filter on
 *  (`JobSearchParams.unmatchedPlaceMentions`, echoed on the response). */
export interface LocationReport {
    unmatchedPlaceMentions?: string[];
}

/** The places `state` filters on, as written ("any"/"all" name none). */
export function namedPlaces(state: JobsUrlState): string[] {
    return LOCATION_FACETS.flatMap((key) => state.facets[key] ?? []).filter((v) => v.trim() && !isNeutral(v));
}

/**
 * True when `state` names a place and the search dropped every one of them:
 * the rows are that search with no location at all. The board shows them under
 * a note ("showing results without it"). A For-you pack cannot: its location
 * is an eligibility filter, so a dropped one means no roles there, not the
 * whole world (an Iceland résumé's pack listed ~1M roles from other countries).
 */
export function locationDropped(state: JobsUrlState, result: LocationReport): boolean {
    const named = namedPlaces(state);
    if (named.length === 0) return false;
    const dropped = new Set((result.unmatchedPlaceMentions ?? []).map(fold));
    return named.every((v) => dropped.has(fold(v)));
}

function withoutLocation(facets: JobsUrlState["facets"]): JobsUrlState["facets"] {
    const next = { ...facets };
    for (const key of LOCATION_FACETS) delete next[key];
    return next;
}

function locationRestricted(state: JobsUrlState, ctx: BroadenContext): boolean {
    const chosen = LOCATION_FACETS.some((key) => (state.facets[key] ?? []).some((v) => !isNeutral(v)));
    return chosen || Boolean(ctx.autoLocationLabel);
}

/** Every broadening that applies to `state`, before counts decide which are worth showing. */
export function broadenRungs(state: JobsUrlState, ctx: BroadenContext = {}): BroadenRung[] {
    const rungs: BroadenRung[] = [];
    const restricted = locationRestricted(state, ctx);
    const change = (patch: Partial<JobsUrlState>): JobsUrlState => ({ ...state, ...patch });

    if (restricted) {
        rungs.push({
            id: "remote_anywhere",
            label: "Remote roles anywhere",
            next: change({ facets: { ...withoutLocation(state.facets), location_country: ANY_LOCATION, work_type: ["remote"] } }),
        });
    }
    if (restricted && ctx.relocation?.open) {
        const named = ctx.relocation.countries;
        const current = (state.facets.location_country ?? []).filter((v) => !isNeutral(v));
        rungs.push({
            id: "relocation",
            label: named.length > 0 ? `Also ${named.join(", ")} (you're open to relocating)` : "Anywhere (you're open to relocating)",
            next: change({
                facets: {
                    ...withoutLocation(state.facets),
                    location_country: named.length > 0 ? [...new Set([...current, ...named])] : ANY_LOCATION,
                },
            }),
        });
    }
    if (ctx.autoLocationLabel && !LOCATION_FACETS.some((key) => state.facets[key]?.length)) {
        rungs.push({
            id: "remove_location",
            label: `Remove ${ctx.autoLocationLabel}`,
            next: change({ facets: { ...state.facets, location_country: ANY_LOCATION } }),
        });
    }
    if (state.facets.experience_level?.length || state.yearsExperience) {
        const facets = { ...state.facets };
        delete facets.experience_level;
        rungs.push({ id: "any_seniority", label: "Any seniority", next: change({ facets, yearsExperience: undefined }) });
    }
    if (state.postedBucket) {
        const wider = WIDER_POSTED[state.postedBucket];
        rungs.push({
            id: "any_date",
            label: wider ? POSTED_LABEL[wider] : "Any date",
            next: change({ postedBucket: wider, postedExplicit: true }),
        });
    }
    return rungs;
}

export interface ResolveBroadenInput {
    state: JobsUrlState;
    /** Results the current filters return. */
    total: number;
    ctx?: BroadenContext;
    /** The same search call the results come from. */
    search: (params: JobSearchParams) => Promise<JobSearchResult & LocationReport>;
}

type SearchFn = ResolveBroadenInput["search"];

export interface CountOptions {
    /** See `BroadenContext.locationRequired`. */
    locationRequired?: boolean;
}

/** How many results `state` returns, from the search call the results use; `null` when that call fails. */
export async function countResults(state: JobsUrlState, search: SearchFn, opts: CountOptions = {}): Promise<number | null> {
    try {
        const result = await search({ ...searchParamsFromUrlState(state), limit: 1, offset: 0 });
        if (result.unavailable === true || !result.configured) return null;
        return opts.locationRequired && locationDropped(state, result) ? 0 : result.total;
    } catch {
        return null;
    }
}

/** Rungs with their real counts; only those that add results, in ladder order. */
export async function resolveBroadenOptions({ state, total, ctx, search }: ResolveBroadenInput): Promise<BroadenOption[]> {
    const counted = await Promise.all(
        broadenRungs(state, ctx).map(async (rung): Promise<BroadenOption | null> => {
            const count = await countResults(rung.next, search, { locationRequired: ctx?.locationRequired });
            return count === null ? null : { ...rung, count };
        }),
    );
    return counted.filter((option): option is BroadenOption => option !== null && option.count > total);
}
