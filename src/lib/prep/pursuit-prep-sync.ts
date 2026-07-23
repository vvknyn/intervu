"use client";

/**
 * Durable prep progress — the chokepoint DashboardContainer calls instead of
 * touching `localStorage` directly (jobs-first bloom PR3, spec §3).
 *
 * localStorage stays the fast/guest layer: every write lands there
 * synchronously and unconditionally, exactly as before this file existed.
 * The server mirror (`applications/{id}/prep/{planCacheKey}`) is additive —
 * it only engages when BOTH a signed-in user AND a pursuit context are
 * present. A prep session with no pursuitId (guest, or a standalone /prep
 * visit) is byte-for-byte the old localStorage-only behavior: absent stays
 * absent, nothing is silently synced.
 *
 * The recency decision when both a local and a server copy exist is the
 * pure `pickNewerSessionState` (session-progress.ts) — kept there, not
 * here, so the decision itself is unit-testable without mocking I/O.
 */

import {
    parseSessionState,
    serializeSessionState,
    sessionStorageKey,
    pickNewerSessionState,
    type PrepSessionState,
} from "@/lib/prep/session-progress";
import { getPursuitPrepProgress, savePursuitPrepProgress, recordPursuitPrepVisit } from "@/actions/pursuit-prep";
import { invalidatePursuitsCache } from "@/lib/pursuits/use-pursuits";

function readLocal(planCacheKey: string): PrepSessionState | null {
    try {
        const raw = localStorage.getItem(sessionStorageKey(planCacheKey));
        return raw ? parseSessionState(raw) : null;
    } catch {
        return null;
    }
}

function writeLocal(state: PrepSessionState): void {
    try {
        localStorage.setItem(sessionStorageKey(state.planCacheKey), serializeSessionState(state));
    } catch {
        /* quota exceeded / private mode — matches the prior inline behavior. */
    }
}

/** Hydrate a prep session for `planCacheKey`: local-first, reconciled
 *  against the pursuit's durable copy when signed in with a pursuit. */
export async function loadPrepProgress(
    planCacheKey: string,
    pursuitId: string | null,
    signedIn: boolean,
): Promise<PrepSessionState | null> {
    const local = readLocal(planCacheKey);
    if (!signedIn || !pursuitId) return local;

    try {
        const res = await getPursuitPrepProgress(pursuitId);
        const server = res.data?.find((entry) => entry.planCacheKey === planCacheKey)?.state ?? null;
        const winner = pickNewerSessionState(local, server);
        if (winner && winner !== local) writeLocal(winner);
        return winner;
    } catch {
        // Network/server failure — local is still a valid answer (this is a
        // best-effort mirror, not the source of truth for a fresh device).
        return local;
    }
}

/** Persist a prep session write: localStorage always (the UI's synchronous
 *  source of truth), the pursuit's durable copy additionally — and only —
 *  when signed in with a pursuit. Fire-and-forget: the local write already
 *  satisfies the caller, the server mirror is best-effort. */
export function savePrepProgress(state: PrepSessionState, pursuitId: string | null, signedIn: boolean): void {
    writeLocal(state);
    if (!signedIn || !pursuitId) return;
    savePursuitPrepProgress(pursuitId, state.planCacheKey, state).catch(() => {
        /* non-critical — localStorage already has the write. */
    });
}

/** Marks that a prep session ran against this pursuit (spec §3 stage 4).
 *  Fire-and-forget; invalidates the shared pursuits cache on success so
 *  other mounted consumers (TopBar, an open /yours tab) pick up the new
 *  `last_prepped_at` on their next render. */
export function markPursuitPrepVisited(pursuitId: string): void {
    recordPursuitPrepVisit(pursuitId)
        .then((res) => {
            if (!res.error) invalidatePursuitsCache();
        })
        .catch(() => {
            /* non-critical — this is a "prepped Nd ago" display nicety. */
        });
}
