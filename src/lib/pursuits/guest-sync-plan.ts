import type { Pursuit } from "@/lib/pursuits/types";

export interface GuestSyncOutcome {
    guest: Pick<Pursuit, "id" | "job_id">;
    /** The account row id the server confirmed; null when it did not. */
    serverId: string | null;
    /** The guest row carries a résumé copy the account has not taken. */
    copyHeld: boolean;
}

export interface GuestSyncPlan {
    /** Guest rows fully landed: safe to delete from this device. */
    remove: Set<string>;
    /** Guest rows that must stay for their held copy, keyed to the account row they became. */
    rekey: Map<string, string>;
}

/**
 * Pure. A row holding a résumé copy the account has not taken is never removed.
 * A job-linked one is re-synced by an idempotent upsert; any other would be
 * created again on every retry, so it is marked with the account row it already is.
 */
export function planGuestSync(outcomes: readonly GuestSyncOutcome[]): GuestSyncPlan {
    const plan: GuestSyncPlan = { remove: new Set(), rekey: new Map() };
    for (const { guest, serverId, copyHeld } of outcomes) {
        if (!serverId) continue;
        if (!copyHeld) plan.remove.add(guest.id);
        else if (!guest.job_id) plan.rekey.set(guest.id, serverId);
    }
    return plan;
}
