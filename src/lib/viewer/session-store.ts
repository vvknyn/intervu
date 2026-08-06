/**
 * In-process store for viewer sessions. Deliberately not a database.
 *
 * A session is two SDP blobs that are worthless fifteen minutes after they
 * were written: nothing here wants durability, queries, or history. The
 * Firestore version spent ~450 document reads per watch session purely to
 * ask "has the phone answered yet" — real cost, guarding data with no value.
 * intervu.cc runs as a single container with no replicas (verified on the
 * box, 2026-08-05), so one process sees every request and a Map is correct.
 *
 * The day intervu runs more than one instance this breaks LOUDLY-ADJACENT
 * rather than loudly: a session created on one instance 404s on the other
 * and the phone reports "this session has ended". Move to Redis or sticky
 * routing THEN — not before there is a second instance to justify it.
 *
 * Keyed on globalThis rather than held in a module variable because Next
 * bundles each route separately: the doorbell route and the signal route
 * would otherwise each get a private copy of this module, and a session
 * created by one would never be visible to the other.
 */
import { isExpired, newSessionId, VIEWER_SESSION_TTL_MS, type SignalBlob, type ViewerSession } from "./sessions";

const sessions: Map<string, ViewerSession> = ((globalThis as { __viewerSessions?: Map<string, ViewerSession> }).__viewerSessions ??= new Map());

/** Async signatures kept although nothing awaits: the routes were written
 *  against a remote store, and a future Redis swap should be a re-import,
 *  not a rewrite. */
export async function createSession(uid: string, now = Date.now()): Promise<ViewerSession> {
    // Every create sweeps the dead, so abandoned sessions — a link sent but
    // never opened — cannot accumulate. authorizeSession already refuses
    // expired ones on read; this is memory hygiene, not access control.
    for (const [id, s] of sessions) {
        if (isExpired(s, now)) sessions.delete(id);
    }
    const session: ViewerSession = {
        id: newSessionId(),
        uid,
        createdAt: now,
        expiresAt: now + VIEWER_SESSION_TTL_MS,
        host: null,
        guest: null,
    };
    sessions.set(session.id, session);
    return session;
}

export async function getSession(id: string): Promise<ViewerSession | null> {
    return sessions.get(id) ?? null;
}

export async function putSignal(id: string, role: "host" | "guest", blob: SignalBlob): Promise<void> {
    // A signal for a session deleted in the meantime is dropped, not
    // resurrected. (The Firestore merge-write quietly re-created a ghost
    // document in this race.)
    const session = sessions.get(id);
    if (session) session[role] = blob;
}

export async function deleteSession(id: string): Promise<void> {
    sessions.delete(id);
}
