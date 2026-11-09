import type { FilterState } from "@/components/jobs/FilterPanel";
import type { JobSearchParams, PostedBucket } from "./types";

/**
 * Filter values the page applies on a fresh visit that nobody chose. The ONE
 * home of these values: the URL state, the pristine filter state and the
 * server all read here.
 */
export const SEARCH_DEFAULTS = { postedBucket: "90d" } as const satisfies { postedBucket: PostedBucket };

export type DefaultedField = keyof typeof SEARCH_DEFAULTS;

/**
 * Pure (client): does a fresh-visit default yield to what the searcher chose?
 * An employer they chose (`companyDomain`: the search box's Companies pick,
 * a company page's link to its roles) lists all its open roles, so the date
 * window nobody chose does not narrow it. Release 76's live check picked
 * "Bank of America" and read "Nothing matches these filters": its one role
 * was older than 90 days. A window they choose still applies.
 */
export function defaultsYieldToChoice(state: Partial<Pick<FilterState, "companyDomain">>): boolean {
    return Boolean(state.companyDomain?.trim());
}

/** Pure (client): the fresh-visit date window is in force: untouched, and not yielding to a chosen employer. */
export function defaultWindowApplies(
    state: Pick<FilterState, "postedBucket"> & Partial<Pick<FilterState, "postedExplicit" | "companyDomain">>,
): boolean {
    return state.postedBucket === SEARCH_DEFAULTS.postedBucket && !state.postedExplicit && !defaultsYieldToChoice(state);
}

/** Pure (client): which fields of the request are still the untouched fresh-visit defaults. */
export function defaultedFields(
    state: Pick<FilterState, "postedBucket" | "postedExplicit"> & Partial<Pick<FilterState, "companyDomain">>,
): DefaultedField[] | undefined {
    const out: DefaultedField[] = [];
    if (defaultWindowApplies(state)) out.push("postedBucket");
    return out.length ? out : undefined;
}

/**
 * Pure (server): the request as the understanding stages must see it — a
 * defaulted field is unset, so "explicit selection wins" only ever protects a
 * real choice. `restoreDefaults` puts back whatever no stage filled in.
 */
export function stripDefaulted(p: JobSearchParams): JobSearchParams {
    if (!p.defaultedFields?.length) return p;
    const rest = { ...p };
    for (const f of p.defaultedFields) delete rest[f];
    return rest;
}

export function restoreDefaults(understood: JobSearchParams, raw: JobSearchParams): JobSearchParams {
    const out = { ...understood };
    for (const f of raw.defaultedFields ?? []) {
        if (out[f] === undefined) Object.assign(out, { [f]: SEARCH_DEFAULTS[f] });
    }
    return out;
}
