import type { FilterState } from "@/components/jobs/FilterPanel";
import type { JobSearchParams, PostedBucket } from "./types";

/**
 * Filter values the page applies on a fresh visit that nobody chose. The ONE
 * home of these values: the URL state, the pristine filter state and the
 * server all read here.
 */
export const SEARCH_DEFAULTS = { postedBucket: "90d" } as const satisfies { postedBucket: PostedBucket };

export type DefaultedField = keyof typeof SEARCH_DEFAULTS;

/** Pure (client): which fields of the request are still the untouched fresh-visit defaults. */
export function defaultedFields(
    state: Pick<FilterState, "postedBucket" | "postedExplicit">,
): DefaultedField[] | undefined {
    const out: DefaultedField[] = [];
    if (state.postedBucket === SEARCH_DEFAULTS.postedBucket && !state.postedExplicit) out.push("postedBucket");
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
