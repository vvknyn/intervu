/**
 * Firestore persistence for viewer sessions. Separated from ./sessions.ts so
 * the access rule stays testable without the Admin SDK.
 *
 * Rows are tiny and short-lived. Nothing sweeps them: `authorizeSession`
 * refuses an expired session on read, and the viewer deletes its own session
 * at handoff, so an abandoned row is inert rather than a leak.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { newSessionId, VIEWER_SESSION_TTL_MS, type SignalBlob, type ViewerSession } from "./sessions";

const COLLECTION = "viewer_sessions";

const doc = (id: string) => getAdminDb().collection(COLLECTION).doc(id);

export async function createSession(uid: string, now = Date.now()): Promise<ViewerSession> {
    const session: ViewerSession = {
        id: newSessionId(),
        uid,
        createdAt: now,
        expiresAt: now + VIEWER_SESSION_TTL_MS,
        host: null,
        guest: null,
    };
    await doc(session.id).set(session);
    return session;
}

export async function getSession(id: string): Promise<ViewerSession | null> {
    const snap = await doc(id).get();
    return snap.exists ? (snap.data() as ViewerSession) : null;
}

export async function putSignal(id: string, role: "host" | "guest", blob: SignalBlob): Promise<void> {
    await doc(id).set({ [role]: blob }, { merge: true });
}

export async function deleteSession(id: string): Promise<void> {
    await doc(id).delete();
}
