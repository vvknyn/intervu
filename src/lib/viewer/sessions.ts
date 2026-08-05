/**
 * Viewer sessions: the doorbell's rules, with no I/O.
 *
 * A session exists only to let two devices find each other. It carries
 * connection details and never a single frame of media — the pixels go
 * peer-to-peer, so "we cannot see your screen" holds by construction.
 *
 * Kept free of Firestore (see ./session-store.ts) so the security rule below
 * is unit-testable without the Admin SDK, and so a route that only needs the
 * rule doesn't pull the SDK into its module graph.
 */
import { randomBytes } from "node:crypto";

export const VIEWER_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * One side's connection details. Just the SDP: both peers finish ICE
 * gathering before they signal, so the candidates are already inside it.
 * Verified on werift 0.24.3 — `await setLocalDescription()` leaves
 * `iceGatheringState` at "complete" with a `typ srflx` candidate in the SDP —
 * and the browser side waits for `icegatheringstatechange` to reach the same
 * point. There is no separate candidate relay because nothing needs one.
 */
export type SignalBlob = { sdp: string };

export type ViewerSession = {
    id: string;
    uid: string;
    createdAt: number;
    expiresAt: number;
    host: SignalBlob | null;
    guest: SignalBlob | null;
};

export type SessionAuthResult<T> =
    | { ok: true; session: T }
    | { ok: false; status: 401 | 404; error: string };

/** 24 random bytes. The id is a capability, so guessing must be hopeless. */
export function newSessionId(): string {
    return randomBytes(24).toString("base64url");
}

/**
 * The whole access rule, in one place, so every route applies it identically.
 *
 * A caller who is not logged in gets 401 — actionable, and the phone page
 * turns it into a login prompt. Everything else collapses to 404: a session
 * that never existed, one that has expired, and one belonging to a different
 * account are deliberately indistinguishable. A 403 on the last case would
 * confirm to whoever holds a leaked link that the link is real, which is the
 * one fact the unguessable id exists to withhold.
 *
 * The admitted session comes back in the result so callers get it already
 * narrowed to non-null — the guarantee lives in the type rather than in a
 * non-null assertion at every call site.
 */
export function authorizeSession<T extends Pick<ViewerSession, "uid" | "expiresAt">>(
    session: T | null,
    uid: string | null,
    now = Date.now(),
): SessionAuthResult<T> {
    if (!uid) return { ok: false, status: 401, error: "unauthorized" };
    if (!session || now >= session.expiresAt || session.uid !== uid) {
        return { ok: false, status: 404, error: "not_found" };
    }
    return { ok: true, session };
}
