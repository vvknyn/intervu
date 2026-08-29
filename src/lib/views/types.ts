/**
 * JobView — "a job the signed-in user has opened" (viewed-jobs history).
 *
 * Backed by the Firestore `job_views` collection, doc id `${uid}_${jobId}`
 * (idempotent upsert — one row per user per job, never a growing log).
 * Mirrors the shape convention `lib/pursuits/types.ts` sets for `Pursuit`:
 * pure module, no I/O, no React — safe to unit-test and safe to import from
 * both server actions (`actions/views.ts`) and client code (`use-viewed.ts`).
 */

import type { JobSnapshot } from "@/lib/pursuits/types";

export interface JobView {
    id: string;
    user_id: string;
    job_id: string;
    /** Set once, at create — never overwritten by a later view. */
    first_viewed_at: string;
    /** Bumped on every view. */
    last_viewed_at: string;
    view_count: number;
    /** Same shape pursuits capture at go-after time — see
     *  `buildJobSnapshot` (pursuits/types.ts), reused as-is here so the two
     *  collections can never disagree about what a job snapshot contains. */
    job_snapshot: JobSnapshot;
}

/** `getJobViewsAction`'s read query is deliberately unordered (`user_id ==
 *  uid` only, no `orderBy` — mirrors `getApplications`, avoids a composite
 *  index). This is the single sort+cap chokepoint both that action and any
 *  client consumer of its result (`use-viewed.ts`, the /yours/history page)
 *  call, so they can never disagree about ordering or the cap. */
export const MAX_JOB_VIEWS = 500;

export function orderJobViewsLatestFirst(views: JobView[]): JobView[] {
    return [...views]
        .sort((a, b) => Date.parse(b.last_viewed_at) - Date.parse(a.last_viewed_at))
        .slice(0, MAX_JOB_VIEWS);
}
