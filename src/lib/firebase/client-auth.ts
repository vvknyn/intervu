/**
 * Client-side Firebase auth helpers.
 * Handles sign-in, sign-up, sign-out, and session cookie sync.
 */

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    confirmPasswordReset,
    User,
    updatePassword,
} from "firebase/auth";
import { getFirebaseAuth } from "./config";

export type { User } from "firebase/auth";

declare global {
    interface Window {
        /** Set by Playwright addInitScript in e2e — never in production UI. */
        __INTERVU_E2E_AUTH__?: User;
    }
}

function e2eMockUser(): User | null {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    return window.__INTERVU_E2E_AUTH__ ?? null;
}

/**
 * Sync the Firebase ID token to a server-side session cookie.
 */
async function syncSessionCookie(user: User) {
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

/**
 * Sign in with username (converted to email) and password.
 */
export async function signInWithUsername(username: string, password: string): Promise<User> {
    const auth = getFirebaseAuth();
    const email = `${username}@intervu.cc`;
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await syncSessionCookie(user);
    return user;
}

/**
 * Sign up with username and password.
 */
export async function signUpWithUsername(username: string, password: string): Promise<User> {
    const auth = getFirebaseAuth();
    const email = `${username}@intervu.cc`;
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await syncSessionCookie(user);
    return user;
}

/**
 * Sign out from Firebase and clear session cookie.
 */
export async function signOut() {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
    await clearSessionCookie();
}

/**
 * Get the current user (client-side).
 */
export function getCurrentUser(): User | null {
    const mock = e2eMockUser();
    if (mock) return mock;
    try {
        return getFirebaseAuth().currentUser;
    } catch {
        return null;
    }
}

/**
 * Listen for auth state changes.
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
    const mock = e2eMockUser();
    if (mock) {
        callback(mock);
        return () => {};
    }
    try {
        return onAuthStateChanged(getFirebaseAuth(), callback);
    } catch {
        callback(null);
        return () => {};
    }
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
