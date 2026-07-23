"use server";

/**
 * Durable prep progress (jobs-first bloom PR3, spec §3): a subcollection
 * under the pursuit that owns it — `applications/{pursuitId}/prep/{planCacheKey}`
 * — one doc per prep plan the user has run against this pursuit. Ownership
 * is checked via the parent `applications` doc's `user_id`, same pattern as
 * every other pursuit mutation in actions/application.ts.
 *
 * `state` is stored serialized (via `serializeSessionState`), not as a raw
 * nested object: the session reducer's RETRY action legitimately sets
 * `critique: undefined` to clear a prior critique, and the Admin SDK rejects
 * `undefined` field values outright (ignoreUndefinedProperties is off — see
 * `updateApplication` in application.ts for the same constraint). JSON
 * round-tripping drops those keys exactly like the localStorage fast layer
 * already does, so this reuses the same serialize/parse pair rather than
 * inventing a second undefined-stripping path.
 */

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { serializeSessionState, parseSessionState, type PrepSessionState } from "@/lib/prep/session-progress";

/** Load the pursuit doc and verify the caller owns it. Returns its
 *  `prep` subcollection ref, or null if missing/not owned. */
async function ownedPursuitPrepCollection(pursuitId: string, uid: string) {
    const db = getAdminDb();
    const pursuitRef = db.collection("applications").doc(pursuitId);
    const doc = await pursuitRef.get();
    if (!doc.exists || doc.data()?.user_id !== uid) return null;
    return { pursuitRef, prepRef: pursuitRef.collection("prep") };
}

export interface StoredPrepProgress {
    planCacheKey: string;
    state: PrepSessionState;
    updated_at: string;
}

/** Mirror a prep session write onto its pursuit (one doc per planCacheKey). */
export async function savePursuitPrepProgress(
    pursuitId: string,
    planCacheKey: string,
    progress: PrepSessionState,
): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const collections = await ownedPursuitPrepCollection(pursuitId, user.uid);
        if (!collections) return { error: "Pursuit not found" };

        await collections.prepRef.doc(planCacheKey).set({
            state_json: serializeSessionState(progress),
            updated_at: new Date().toISOString(),
        });
        return {};
    } catch (error) {
        console.error("Error saving pursuit prep progress:", error);
        return { error: error instanceof Error ? error.message : "Failed to save prep progress" };
    }
}

/** All durable prep progress recorded against this pursuit, one entry per
 *  planCacheKey the caller has prepped this pursuit against. */
export async function getPursuitPrepProgress(
    pursuitId: string,
): Promise<{ data?: StoredPrepProgress[]; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const collections = await ownedPursuitPrepCollection(pursuitId, user.uid);
        if (!collections) return { error: "Pursuit not found" };

        const snapshot = await collections.prepRef.get();
        const data: StoredPrepProgress[] = [];
        for (const doc of snapshot.docs) {
            const raw = doc.data();
            const state = typeof raw.state_json === "string" ? parseSessionState(raw.state_json) : null;
            if (!state) continue;
            data.push({ planCacheKey: doc.id, state, updated_at: raw.updated_at ?? state.updatedAt });
        }
        return { data };
    } catch (error) {
        console.error("Error fetching pursuit prep progress:", error);
        return { error: error instanceof Error ? error.message : "Failed to fetch prep progress" };
    }
}

/** Records that a prep session ran against this pursuit (spec §3 stage 4) —
 *  `stageLabel` (lib/pursuits/types.ts) reads this back to show "prepped 2d
 *  ago" on /yours rows. */
export async function recordPursuitPrepVisit(pursuitId: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const collections = await ownedPursuitPrepCollection(pursuitId, user.uid);
        if (!collections) return { error: "Pursuit not found" };

        await collections.pursuitRef.update({ last_prepped_at: new Date().toISOString() });
        return {};
    } catch (error) {
        console.error("Error recording pursuit prep visit:", error);
        return { error: error instanceof Error ? error.message : "Failed to record prep visit" };
    }
}
