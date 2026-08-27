/**
 * Client-side Firebase auth helpers.
 * Handles sign-in, sign-up, sign-out, and session cookie sync.
 */

import {
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    confirmPasswordReset,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    User as FirebaseUser,
    updatePassword,
} from "firebase/auth";
import { getFirebaseAuth } from "./config";
import { usernameEmail } from "@/lib/auth/username-email";
import type { ServerUser } from "@/lib/auth/workos-identity";

/**
 * Who is signed in, as far as the UI is concerned — deliberately NOT Firebase's
 * `User` any more.
 *
 * Firebase's listener cannot see a WorkOS session, so while this type was
 * Firebase's, anyone signing in through AuthKit was authenticated to every
 * server action while the UI rendered them signed out. Narrowing the exported
 * type to the shape both providers can produce is what lets one channel carry
 * either. It is the same `ServerUser` the server resolves, including the
 * `externalId → uid` rule that keeps a migrated user attached to their data.
 *
 * The 20-odd consumers import this name and needed no edit; anything that had
 * depended on a Firebase-only field would now fail to compile, which is the
 * point.
 */
export type { ServerUser as User } from "@/lib/auth/workos-identity";

const googleProvider = new GoogleAuthProvider();

declare global {
    interface Window {
        /** Set by Playwright addInitScript in e2e — never in production UI. */
        __INTERVU_E2E_AUTH__?: FirebaseUser;
    }
}

function e2eMockUser(): FirebaseUser | null {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    return window.__INTERVU_E2E_AUTH__ ?? null;
}

/**
 * Sync the Firebase ID token to a server-side session cookie.
 */
async function syncSessionCookie(user: FirebaseUser) {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
        // A failed session POST means server-side auth (Admin SDK reads of the
        // session cookie) will see the user as logged out, even though the client
        // SDK has them signed in — leading to silent "Unauthorized" on every
        // server action. Surface it instead of swallowing.
        let detail = "";
        try {
            detail = await res.text();
        } catch {
            /* ignore */
        }
        throw new Error(
            `Failed to establish session (${res.status}). ${detail}`.trim(),
        );
    }
}

/**
 * Clear the server-side session cookie.
 */
async function clearSessionCookie() {
    await fetch("/api/auth/session", { method: "DELETE" });
}

/** Shared by every password sign-in path: authenticate, then exchange the
 *  ID token for the server-side session cookie. `signInWithUsername` and
 *  `signInWithEmail` differ only in how they get to an email address. */
async function signInWithCredentials(email: string, password: string): Promise<FirebaseUser> {
    const auth = getFirebaseAuth();
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await syncSessionCookie(user);
    return user;
}

/**
 * Sign in with username (converted to email) and password. Legacy path for
 * accounts created before the signup-ladder audit (2026-08-20), which are
 * still registered under the synthesized `<username>@intervu.cc` address —
 * see lib/auth/username-email.ts. Signup no longer mints these; this stays
 * only so those existing accounts keep logging in with a bare username.
 */
export async function signInWithUsername(username: string, password: string): Promise<FirebaseUser> {
    return signInWithCredentials(usernameEmail(username), password);
}

/**
 * Sign in with a real, user-supplied email and password — the path every
 * account created after the signup-ladder audit uses (both the "@"-bearing
 * branch of the login identifier field, and post-signup auto-login).
 */
export async function signInWithEmail(email: string, password: string): Promise<FirebaseUser> {
    return signInWithCredentials(email, password);
}

/** True when a typed login identifier is a real email rather than a bare
 *  username — the shape decides, not an enumerated list of who is legacy.
 *  Exported (rather than left inline) so the routing decision is
 *  unit-testable without React or Firebase, and so it can't drift into two
 *  different rules across the login surfaces that use it. */
export function isEmailIdentifier(identifier: string): boolean {
    return identifier.trim().includes("@");
}

/**
 * Sign in with whatever was typed into the single "Email or username"
 * field. An email takes `signInWithEmail` directly (every account created
 * after the 2026-08-20 signup-ladder audit); a bare username takes the
 * legacy `signInWithUsername` re-derivation (accounts that predate it — see
 * that function's doc). One chokepoint so every login surface shares the
 * same routing rule instead of each re-deriving it.
 */
export async function signInWithIdentifier(identifier: string, password: string): Promise<FirebaseUser> {
    const trimmed = identifier.trim();
    return isEmailIdentifier(trimmed)
        ? signInWithEmail(trimmed, password)
        : signInWithUsername(trimmed, password);
}

/** True when the user backed out of the Google popup themselves (closed it,
 *  or fired a second popup before the first settled) — not a failure, just
 *  "never mind." Callers show calm copy instead of an error banner. */
export function isPopupCancelled(err: unknown): boolean {
    const code = (err as { code?: string } | null)?.code;
    return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

/** True only when the browser itself refused to open the popup (blocked by
 *  a popup blocker) — distinct from the user cancelling one that did open. */
function isPopupBlocked(err: unknown): boolean {
    return (err as { code?: string } | null)?.code === "auth/popup-blocked";
}

/**
 * Sign in with Google. Tries a popup first — same session-cookie exchange
 * `signInWithUsername` uses (`syncSessionCookie`), completed immediately
 * without leaving the page. If the browser blocks the popup outright, falls
 * back to a full-page redirect instead of failing: `getFirebaseAuth()`'s
 * `onAuthStateChanged` fires with the signed-in user once the browser
 * returns from Google, and the app's existing "re-mint the session cookie on
 * first sign-in this load" effect (see TopBar's `refreshSession` call)
 * completes the same exchange generically — no separate redirect-result
 * handler needed. Returns `null` when the redirect fallback fired (the page
 * is about to navigate away, so there's no user to hand back yet).
 */
export async function signInWithGoogle(): Promise<FirebaseUser | null> {
    const auth = getFirebaseAuth();
    try {
        const { user } = await signInWithPopup(auth, googleProvider);
        await syncSessionCookie(user);
        return user;
    } catch (err) {
        if (isPopupBlocked(err)) {
            await signInWithRedirect(auth, googleProvider);
            return null;
        }
        throw err;
    }
}

/**
 * Sign out from Firebase and clear session cookie.
 */
export async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
    await clearSessionCookie();
    // A WorkOS sign-in leaves a cookie Firebase knows nothing about. Clearing
    // only Firebase would drop the UI to signed-out while `getServerUser()`
    // kept answering with a live WorkOS session on the very next render —
    // "sign out" that signs nobody out. Sent unconditionally: the route is
    // harmless when there is no WorkOS session, and asking first would mean
    // trusting the same client-side view that missed the session to begin with.
    await fetch("/auth/signout", { method: "POST", redirect: "manual" }).catch(() => {});
}

/** Narrow a Firebase user to the shape both providers can produce. */
function toClientUser(user: FirebaseUser): ServerUser {
    return {
        uid: user.uid,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
    };
}

/**
 * Ask the server who is signed in.
 *
 * `getServerUser()` reads a WorkOS session first and a Firebase session cookie
 * second, so this is the only way the browser can learn about an AuthKit
 * sign-in — the Firebase SDK never will.
 */
async function fetchServerUser(): Promise<ServerUser | null> {
    try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return null;
        const body = (await res.json()) as { user?: ServerUser | null };
        return body.user ?? null;
    } catch {
        // Offline or mid-deploy. "Unknown" is not "signed out", but the caller
        // has nothing else to render, and the next auth event re-asks.
        return null;
    }
}

/**
 * Get the current user (client-side).
 *
 * Synchronous, so it can only answer from Firebase's in-memory state — a
 * WorkOS-only session reads as null here and is corrected a moment later by
 * `onAuthChange`. Callers use this for a first paint, never as the last word.
 */
export function getCurrentUser(): ServerUser | null {
    const mock = e2eMockUser();
    if (mock) return toClientUser(mock);
    try {
        const user = getFirebaseAuth().currentUser;
        return user ? toClientUser(user) : null;
    } catch {
        return null;
    }
}

/**
 * Listen for auth state changes — from EITHER provider.
 *
 * The app's single client-side auth chokepoint: ~20 surfaces subscribe here,
 * so this is the one place that has to know identity can now arrive two ways.
 * Firebase's listener is still the fast path and fires synchronously from
 * cache. When it reports nobody, that is not yet an answer — a WorkOS session
 * lives in an httpOnly cookie the SDK cannot see — so the server is asked
 * before anyone is told they are signed out.
 *
 * The cost of that ordering is one extra request per load for genuinely
 * signed-out visitors. The cost of the other ordering was a signed-in user
 * being shown a "Sign in" button, which is what this fixes.
 */
export function onAuthChange(callback: (user: ServerUser | null) => void): () => void {
    const mock = e2eMockUser();
    if (mock) {
        callback(toClientUser(mock));
        return () => {};
    }

    // An in-flight server lookup outlives unsubscribe, and React unmounts
    // components mid-flight all the time. Without this latch a resolved fetch
    // calls back into a dead subscriber.
    let cancelled = false;
    const emit = (user: ServerUser | null) => {
        if (!cancelled) callback(user);
    };

    let unsubscribe = () => {};
    try {
        unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
            if (user) {
                emit(toClientUser(user));
                return;
            }
            void fetchServerUser().then(emit);
        });
    } catch {
        // Firebase not configured in this environment — WorkOS may still be.
        void fetchServerUser().then(emit);
    }

    return () => {
        cancelled = true;
        unsubscribe();
    };
}

/**
 * Send password reset email.
 */
export async function sendResetEmail(email: string) {
    const auth = getFirebaseAuth();
    await sendPasswordResetEmail(auth, email);
}

/**
 * Confirm password reset with code.
 */
export async function confirmReset(code: string, newPassword: string) {
    const auth = getFirebaseAuth();
    await confirmPasswordReset(auth, code, newPassword);
}

/**
 * Update current user's password (requires recent sign-in).
 */
export async function changePassword(newPassword: string) {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) throw new Error("Not authenticated");
    await updatePassword(user, newPassword);
}

/**
 * Refresh the session cookie (e.g., after token refresh).
 */
export async function refreshSession() {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (user) {
        await syncSessionCookie(user);
    }
}
