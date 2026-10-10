/**
 * "Is this posting already in the tracker" for a job marked Applied without
 * a Velai job id (the browser extension's "I applied" on a posting Velai
 * doesn't have). Rows with a job id are found by `findPursuitByJobId`; these
 * are found by the posting's URL, so a second click, a retry or the same
 * page in another tab lands on the row the first one made instead of adding
 * another. Only the URL decides: two different postings with the same title
 * at one employer stay two rows.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { PursuitStage } from "@/lib/pursuits/types";

/** Pure: a posting URL compared without its fragment, `utm_*` tags, `www.`,
 *  a trailing slash or host case. null for anything that isn't http(s). */
export function postingUrlKey(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let u: URL;
    try {
        u = new URL(raw.trim());
    } catch {
        return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const params = [...u.searchParams].filter(([k]) => !k.toLowerCase().startsWith("utm_"));
    params.sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${query}`;
}

export interface TrackedPosting {
    id: string;
    status: PursuitStage;
    applied_at?: string;
}

/** The person's tracker row for this posting URL, if there is one. */
export async function findTrackedPosting(uid: string, applyUrl: string): Promise<TrackedPosting | null> {
    const key = postingUrlKey(applyUrl);
    if (!key) return null;
    const snap = await getAdminDb().collection("applications").where("user_id", "==", uid).get();
    for (const doc of snap.docs) {
        const data = doc.data() as { status: PursuitStage; applied_at?: string; job_url?: string; job_snapshot?: { apply_url?: string } | null };
        if ([data.job_url, data.job_snapshot?.apply_url].some((url) => postingUrlKey(url) === key)) {
            return { id: doc.id, status: data.status, applied_at: data.applied_at };
        }
    }
    return null;
}
