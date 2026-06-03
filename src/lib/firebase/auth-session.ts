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
 * Get the current authenticated user from the session cookie (server-side).
 * Returns null if not authenticated.
 */
export async function getServerUser(): Promise<{ uid: string; email?: string; displayName?: string; customClaims?: Record<string, any> } | null> {
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
            customClaims: decoded,
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
