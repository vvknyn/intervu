/**
 * Client-side auth helpers.
 *
 * Firebase Auth is retired (2026-08-27 WorkOS migration) — password sign-in,
 * signup, and reset now go through `actions/auth.ts`'s server actions, and
 * Google/passkey through WorkOS AuthKit's hosted flow (`/auth/start`,
 * `/auth/callback`). What's left here is what every one of those paths still
 * shares once the session lands in an httpOnly cookie: asking the server who
 * is signed in, and telling it to clear that cookie.
 */

import type { ServerUser } from "@/lib/auth/workos-identity";

/**
 * Who is signed in, as far as the UI is concerned — deliberately NOT
 * Firebase's `User`. This is the same `ServerUser` the server resolves,
 * including the `externalId → uid` rule that keeps a migrated user attached
 * to their data. The ~20 consumers importing this name needed no edit.
 */
export type { ServerUser as User } from "@/lib/auth/workos-identity";

declare global {
    interface Window {
        /** Set by Playwright addInitScript in e2e — never in production UI. */
        __INTERVU_E2E_AUTH__?: ServerUser;
    }
}

function e2eMockUser(): ServerUser | null {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    return window.__INTERVU_E2E_AUTH__ ?? null;
}

/**
 * Ask the server who is signed in. The session cookie is httpOnly, so this
 * is the only way the browser can learn about it.
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
 * Get the current user (client-side), synchronously.
 *
 * Only the e2e mock can answer synchronously now that there is no client SDK
 * holding session state in memory — a real session reads as null here and is
 * corrected a moment later by `onAuthChange`. Callers use this for a first
 * paint, never as the last word.
 */
export function getCurrentUser(): ServerUser | null {
    return e2eMockUser();
}

/**
 * Listen for auth state — the app's single client-side auth chokepoint (~20
 * surfaces subscribe here). There is no client-side listener any more (no SDK
 * holds the session), so every real answer comes from asking the server.
 */
export function onAuthChange(callback: (user: ServerUser | null) => void): () => void {
    const mock = e2eMockUser();
    if (mock) {
        callback(mock);
        return () => {};
    }

    // An in-flight server lookup outlives unsubscribe, and React unmounts
    // components mid-flight all the time. Without this latch a resolved fetch
    // calls back into a dead subscriber.
    let cancelled = false;
    void fetchServerUser().then((user) => {
        if (!cancelled) callback(user);
    });

    return () => {
        cancelled = true;
    };
}

/**
 * Sign out. Hits the one route every provider's session cookie funnels
 * through (`/auth/signout`, backed by WorkOS AuthKit's own `signOut`) —
 * unconditionally, since the route is harmless with no session and asking
 * first would mean trusting the same client-side view that might be wrong.
 */
export async function signOut() {
    await fetch("/auth/signout", { method: "POST", redirect: "manual" }).catch(() => {});
}
