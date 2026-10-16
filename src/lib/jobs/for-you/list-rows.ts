/**
 * The rows a person's own list reads before it weighs fit, the same for the deck and for the packs hub's counts: the
 * search's rows with each opening once (`clusterJobs`: the same title and company in several places is one card), then
 * the roles whose apply link no longer works left out ("closed"), then the roles already in the person's tracker
 * ("the jobs I applied to keep coming back", review 2026-10-13). What is left is what `deckListFor` weighs.
 *
 * Pure, no I/O.
 */
import { hasLiveApplyUrl } from "@/lib/jobs/apply-url-health";
import { clusterJobs } from "@/lib/jobs/cluster";
import type { PublicJob } from "@/lib/jobs/types";

/** Each opening once, in the search's order. */
export function readRows(jobs: readonly PublicJob[]): PublicJob[] {
    return clusterJobs([...jobs]).map((cluster) => cluster.primary);
}

export interface ListCandidates {
    /** The roles the list weighs. */
    candidates: PublicJob[];
    /** Read, then left out because the apply link no longer works. */
    closed: number;
    /** Open and read, then left out because the role is already in the person's tracker. */
    tracked: number;
}

export function listCandidates(rows: readonly PublicJob[], isTracked?: (job: PublicJob) => boolean): ListCandidates {
    const open = rows.filter(hasLiveApplyUrl);
    const candidates = isTracked ? open.filter((job) => !isTracked(job)) : open;
    return { candidates, closed: rows.length - open.length, tracked: open.length - candidates.length };
}
