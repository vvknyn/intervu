/**
 * Firebase session management using cookies.
 * Server actions call getServerUser() to verify the current user from the session cookie.
 * Client-side code sets the cookie after Firebase Auth sign-in.
 */

import { cookies } from "next/headers";
import { getAdminAuth } from "./admin";

const SESSION_COOKIE_NAME = "firebase-session";
const SESSION_EXPIRY_DAYS = 14;

/**
 * The user behind a Firebase session cookie, or null.
 *
 * Callers should ask `getServerUser()` in `@/lib/auth/server-user` instead —
 * it is the provider-agnostic chokepoint and knows about WorkOS too. This
 * function is the Firebase half of it, and exists only until the last issued
 * session cookie expires (14 days), at which point it can be deleted.
 */
export async function getFirebaseServerUser(): Promise<{
    uid: string;
    email?: string;
    displayName?: string;
} | null> {
    try {
        const cookieStore = await cookies();
        const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

        if (!sessionCookie) {
            return null;
        }

        const auth = getAdminAuth();
        const decoded = await auth.verifySessionCookie(sessionCookie, true);

        return {
            uid: decoded.uid,
            email: decoded.email,
            displayName: decoded.name,
        };
    } catch (error) {
        // Session expired or invalid
        return null;
    }
}

/**
 * Create a session cookie from a Firebase ID token (called from API route after client-side login).
 */
export async function createSessionCookie(idToken: string): Promise<string> {
    const auth = getAdminAuth();
    const expiresIn = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    return auth.createSessionCookie(idToken, { expiresIn });
}

/**
 * Set the session cookie in the response.
 */
export async function setSessionCookie(sessionCookie: string) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
        maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        sameSite: "lax",
    });
}

/**
 * Clear the session cookie (sign out).
 */
export async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
}

export { SESSION_COOKIE_NAME };
