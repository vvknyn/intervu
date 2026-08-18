"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { runUserDataPlan } from "@/lib/db/user-data";

/**
 * Hand the signed-in user everything held about them, keyed by the same
 * manifest table names `deleteAccount` sweeps — so what an export shows is
 * exactly what a deletion removes, by construction rather than by two lists
 * being kept in step.
 *
 * NOT WIRED TO ANY UI as of 2026-08-18, and nothing in `/privacy` or
 * `/terms` promises it. Kept because it is the companion to deletion and is
 * now correct; wiring it up is a product decision, not a code one.
 */
export async function exportUserData(): Promise<{ data?: Record<string, unknown>; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const owned = await runUserDataPlan(user.uid, getAdminDb());

        return {
            data: {
                exported_at: new Date().toISOString(),
                user: { id: user.uid, email: user.email || null },
                ...Object.fromEntries(
                    Object.entries(owned).map(([table, docs]) => [
                        table,
                        docs.map((d) => ({ id: d.id, ...d.data })),
                    ])
                ),
            },
        };
    } catch (e) {
        console.error("[Account] Export error:", e);
        return { error: e instanceof Error ? e.message : "Failed to export data" };
    }
}
