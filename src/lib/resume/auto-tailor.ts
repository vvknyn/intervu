import { searchJobsAction } from "@/actions/jobs";
import type { Pursuit } from "@/lib/pursuits/types";
import type { JobAnalysis, TailoringRecommendation } from "@/types/resume";

/**
 * Support for tailoring a résumé straight from a pursuit, with no click.
 *
 * Both halves exist to keep that convenience from becoming expensive or
 * dishonest: `resolvePostingText` refuses to invent a posting, and the cache
 * stops back-navigation from re-billing two model calls for an answer the user
 * already has.
 */

/**
 * The actual posting text behind a pursuit, or null if we don't have one.
 *
 * Order is cheapest-first: the snapshot we stored when the pursuit was created,
 * then the live index. Deliberately NOT falling back to "company + position" —
 * that's a label, and analysing it would produce something that looks like a
 * result while being worth nothing. Callers treat null as "ask the user".
 */
export async function resolvePostingText(pursuit: Pursuit): Promise<string | null> {
    const snapshot = pursuit.job_snapshot?.description?.trim();
    if (snapshot) return snapshot;

    if (!pursuit.job_id) return null;
    const res = await searchJobsAction({ id: pursuit.job_id, limit: 1, offset: 0, hideGhosts: false });
    return res.hits[0]?.description?.trim() || null;
}

interface AutoTailorCacheEntry {
    analysis: JobAnalysis;
    recommendations: TailoringRecommendation[];
}

const key = (pursuitId: string) => `intervu:auto-tailor:${pursuitId}`;

/**
 * Session-scoped on purpose. A posting can change under us, and this is not
 * the right owner for durable analysis state — it only needs to outlive a
 * back-and-forth between the pursuit and the tailor screen.
 */
export function readAutoTailorCache(pursuitId: string): AutoTailorCacheEntry | null {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(key(pursuitId));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as AutoTailorCacheEntry;
    } catch {
        // Unreadable entry is a miss, not a crash — the caller re-runs.
        sessionStorage.removeItem(key(pursuitId));
        return null;
    }
}

export function writeAutoTailorCache(
    pursuitId: string,
    analysis: JobAnalysis,
    recommendations: TailoringRecommendation[],
): void {
    if (typeof sessionStorage === "undefined") return;
    try {
        sessionStorage.setItem(key(pursuitId), JSON.stringify({ analysis, recommendations }));
    } catch {
        // A full or blocked quota costs a cache hit, never the feature.
    }
}
