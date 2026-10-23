import type { Metadata } from "next";
import { indexabilityFor, robotsMetadataFor } from "./indexability";
import { canonicalMetadata } from "./page-metadata";

export const JOBS_TITLE = "Search live jobs from company career pages";
export const JOBS_DESCRIPTION =
    "Search live jobs pulled directly from employer career pages, each checked for freshness and ghost-job risk before you apply.";

/** A Next `searchParams` record as `URLSearchParams` (repeated keys kept). */
export function toURLSearchParams(query: Record<string, string | string[] | undefined>): URLSearchParams {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        for (const one of [value].flat()) if (one != null) search.append(key, one);
    }
    return search;
}

/**
 * Metadata for every page that renders `/jobs` (the page itself and the two
 * server-rendered variants the middleware rewrites it to). The canonical is
 * the policy's, so a `?q=…` variant names bare `/jobs`; its robots meta comes
 * from the same call, so the variant is noindex while the bare page is not.
 */
export function buildJobsMetadata(query: Record<string, string | string[] | undefined> = {}): Metadata {
    const search = toURLSearchParams(query);
    const { canonical } = indexabilityFor("/jobs", search);
    return {
        description: JOBS_DESCRIPTION,
        ...canonicalMetadata(canonical ?? "/jobs", JOBS_TITLE, JOBS_DESCRIPTION),
        ...robotsMetadataFor("/jobs", search),
    };
}
