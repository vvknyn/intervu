import { sincePhrase } from "@/lib/jobs/for-you/today";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * The line a résumé-ranked list carries for someone who comes back: how many of the roles it opens with are new to
 * this device since they were last here. A role counts when this device had not listed it before this sitting
 * (`seenBefore`) AND it carries the row's own "New" mark (first seen and posted within a week,
 * `classifyPostingFreshness`), so the number never claims a role that is merely further down a list it was always in.
 *
 * Honest by construction: a first visit (`sinceMs` null) or a device that has kept no list (`seenBefore` null) says
 * nothing, and so does a visit with nothing new. Returns `null` for all three.
 */
export function listNewSince(input: {
    /** The roles the list opens with (the rows the device records as listed). */
    rows: ReadonlyArray<Pick<PublicJob, "id" | "posted_at" | "first_seen_at">>;
    seenBefore: ReadonlySet<string> | null;
    sinceMs: number | null;
    nowMs: number;
}): { count: number; text: string } | null {
    const { rows, seenBefore, sinceMs, nowMs } = input;
    if (sinceMs == null || seenBefore == null) return null;
    const count = rows.filter((job) => !seenBefore.has(job.id) && classifyPostingFreshness(job, nowMs).kind === "fresh").length;
    if (count === 0) return null;
    const since = sincePhrase(sinceMs, nowMs);
    return { count, text: `${count} new ${since === "today" ? "since you were here earlier today" : since}` };
}
