/**
 * Client-side Supabase auth helpers.
 * Handles sign-in, sign-up, sign-out, and the current-user snapshot.
 *
 * Unlike Firebase, the @supabase/ssr browser client (lib/supabase/client.ts)
 * syncs the session into cookies itself on every sign-in/refresh/sign-out —
 * there is no server round trip to mint or clear a session cookie here.
 */

import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { resolveLegacyUid } from "@/lib/auth/app-tag";
import { usernameEmail } from "@/lib/auth/username-email";

/**
 * The subset of a Supabase user this app's UI ever reads. `uid` is
 * `resolveLegacyUid`'d the same way the server-side getServerUser() is — a
 * migrated user's client-side uid must match their server-side one, since
 * some callers (e.g. PostHog identify) key off it as a stable identity.
 */
export interface User {
    uid: string;
    email: string | null;
    displayName: string | null;
}

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

function toUser(user: SupabaseUser | null | undefined): User | null {
    if (!user) return null;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        null;
    return { uid: resolveLegacyUid(user), email: user.email ?? null, displayName };
}

// A single background listener, started the first time this module is
// asked for auth state, keeps `cachedUser` warm so `getCurrentUser()` can
// stay synchronous (Firebase's `auth.currentUser` was; Supabase's
// `getUser()`/`getSession()` are both promise-based, so something has to
// hold the last-known value). `onAuthStateChange` delivers the current
// session immediately on subscribe, so this is populated within a
// microtask of the client existing — not waiting on any particular
// component to mount an effect.
let cachedUser: User | null = null;
let primed = false;

function ensurePrimed(): void {
    if (primed || typeof window === "undefined") return;
    primed = true;
    createClient().auth.onAuthStateChange((_event, session) => {
        cachedUser = toUser(session?.user);
    });
}

/** Sync snapshot of the signed-in user, or null. */
export function getCurrentUser(): User | null {
    const mock = e2eMockUser();
    if (mock) return mock;
    try {
        ensurePrimed();
        return cachedUser;
    } catch {
        return null;
    }
}

/** Listen for auth state changes. Fires once immediately with the current state. */
export function onAuthChange(callback: (user: User | null) => void): () => void {
    const mock = e2eMockUser();
    if (mock) {
        callback(mock);
        return () => {};
    }
    try {
        ensurePrimed();
        const {
            data: { subscription },
        } = createClient().auth.onAuthStateChange((_event, session) => {
            callback(toUser(session?.user));
        });
        return () => subscription.unsubscribe();
    } catch {
        callback(null);
        return () => {};
    }
}

/** Shared by every password sign-in path. `signInWithUsername` and
 *  `signInWithEmail` differ only in how they get to an email address. */
async function signInWithCredentials(email: string, password: string): Promise<User> {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const user = toUser(data.user);
    if (!user) throw new Error("Sign-in succeeded but no user was returned");
    return user;
}

/**
 * Sign in with username (converted to email) and password. Legacy path for
 * accounts created before the signup-ladder audit (2026-08-20), which are
 * still registered under the synthesized `<username>@intervu.cc` address —
 * see lib/auth/username-email.ts. Signup no longer mints these; this stays
 * only so those existing accounts keep logging in with a bare username.
 */
export async function signInWithUsername(username: string, password: string): Promise<User> {
    return signInWithCredentials(usernameEmail(username), password);
}

/**
 * Sign in with a real, user-supplied email and password — the path every
 * account created after the signup-ladder audit uses (both the "@"-bearing
 * branch of the login identifier field, and post-signup auto-login).
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
    return signInWithCredentials(email, password);
}

/** True when a typed login identifier is a real email rather than a bare
 *  username — the shape decides, not an enumerated list of who is legacy.
 *  Exported (rather than left inline) so the routing decision is
 *  unit-testable without React or Supabase, and so it can't drift into two
 *  different rules across the login surfaces that use it. */
export function isEmailIdentifier(identifier: string): boolean {
    return identifier.trim().includes("@");
}

/**
 * Sign in with whatever was typed into the single "Email or username"
 * field. An email takes `signInWithEmail` directly (every account created
 * after the 2026-08-20 signup-ladder audit); a bare username takes the
 * legacy `signInWithUsername` re-derivation (accounts that predate it — see
 * that function's doc). One chokepoint so login-form.tsx and
 * SimpleAuthForm.tsx share the same routing rule instead of two copies.
 */
export async function signInWithIdentifier(identifier: string, password: string): Promise<User> {
    const trimmed = identifier.trim();
    return isEmailIdentifier(trimmed)
        ? signInWithEmail(trimmed, password)
        : signInWithUsername(trimmed, password);
}

/**
 * Sign in with Google. Unlike Firebase, Supabase has no popup-based OAuth
 * flow — `signInWithOAuth` always navigates the whole browser to Google and
 * back to /auth/callback (the code-exchange route), which redirects back to
 * `next` once the session is established. This function only kicks off that
 * navigation; there is no user to hand back before the page leaves, so
 * callers should treat its resolution as "the browser is about to
 * navigate away," not as sign-in completion.
 */
export async function signInWithGoogle(next: string = "/"): Promise<void> {
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.toString() },
    });
    if (error) throw error;
}

/**
 * Sign out.
 */
export async function signOut(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
}

/**
 * Send password reset email.
 */
export async function sendResetEmail(email: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
}

/**
 * Complete a password reset. Unlike Firebase's `confirmPasswordReset(auth,
 * oobCode, newPassword)`, Supabase needs no explicit code: clicking the
 * emailed reset link lands the browser back here with a recovery session
 * already established (the @supabase/ssr client parses it from the URL on
 * load), so this just updates the password on that session.
 */
export async function confirmReset(newPassword: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}
