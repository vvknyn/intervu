/**
 * Free access grants (launch grant): dated entries on the profile, idempotent per grant id.
 * Access itself is only ever written by recomputeAccess.
 */
import { appendGrantOnce, type Grant } from "@/lib/billing/profile-store";
import { recomputeAccess } from "@/lib/billing/recompute";

/** The grant is stored but access could not be recomputed; re-running the same grant id repairs it. */
export class GrantRecomputeError extends Error {}

/** Stores the grant once per id, then recomputes (also when the id already existed, so a re-run heals). */
export async function grantDays(
    uid: string,
    grant: { id: string; days: number },
    now: number = Date.now(),
): Promise<{ added: boolean; accessUntil: number }> {
    const entry: Grant = { id: grant.id, at: now, days: grant.days };
    const added = await appendGrantOnce(uid, entry);
    try {
        return { added, accessUntil: await recomputeAccess(uid) };
    } catch (error) {
        throw new GrantRecomputeError(error instanceof Error ? error.message : "recompute failed");
    }
}
