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
import { isCurrentSessionEpoch } from "@/lib/auth/session-epoch";

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

const SIGNED_OUT_MARKER = "velai.auth.signedOut";

function e2eMockUser(): ServerUser | null {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    return window.__INTERVU_E2E_AUTH__ ?? null;
}

function isSignedOutMarkerSet(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return sessionStorage.getItem(SIGNED_OUT_MARKER) === "1";
    } catch {
        return false;
    }
}

function setSignedOutMarker(): void {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(SIGNED_OUT_MARKER, "1");
    } catch {
        /* private mode */
    }
}

function clearSignedOutMarker(): void {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.removeItem(SIGNED_OUT_MARKER);
    } catch {
        /* private mode */
    }
}

type SessionFetchResult =
    | { status: "ok"; user: ServerUser | null }
    /** Aborted because a newer epoch started. Must not be applied as signed-out. */
    | { status: "aborted" };

/**
 * Ask the server who is signed in. The session cookie is httpOnly, so this
 * is the only way the browser can learn about it.
 */
async function fetchServerUser(signal?: AbortSignal): Promise<SessionFetchResult> {
    try {
        const res = await fetch("/api/auth/session", {
            cache: "no-store",
            credentials: "same-origin",
            signal,
        });
        if (!res.ok) return { status: "ok", user: null };
        const body = (await res.json()) as { user?: ServerUser | null };
        return { status: "ok", user: body.user ?? null };
    } catch {
        if (signal?.aborted) return { status: "aborted" };
        // Offline or mid-deploy. "Unknown" is not "signed out", but the caller
        // has nothing else to render, and the next auth event re-asks.
        return { status: "ok", user: null };
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

const authListeners = new Set<(user: ServerUser | null) => void>();

let sessionEpoch = 0;
let resolvedEpoch: number | null = null;
let resolvedUser: ServerUser | null = null;
let inflightEpoch: number | null = null;
let inflightFetch: Promise<{ requestEpoch: number; result: SessionFetchResult }> | null = null;
let inflightAbort: AbortController | null = null;
let pageshowRegistered = false;
/** While true, a late session GET must not paint the previous account. */
let applyingSignOut = false;

function notifyAuthListeners(user: ServerUser | null): void {
    authListeners.forEach((listener) => listener(user));
}

function abortInflightSessionFetch(): void {
    inflightAbort?.abort();
    inflightAbort = null;
    inflightFetch = null;
    inflightEpoch = null;
}

function commitSessionUser(requestEpoch: number, user: ServerUser | null): void {
    if (!isCurrentSessionEpoch(requestEpoch, sessionEpoch)) return;
    // A GET that started before the cookie delete can resolve with the old
    // account after sign-out has already committed null. Drop it.
    if (applyingSignOut && user) return;
    resolvedEpoch = requestEpoch;
    resolvedUser = user;
    if (user) {
        clearSignedOutMarker();
    }
    notifyAuthListeners(user);
}

function applySessionFetch(requestEpoch: number, result: SessionFetchResult): void {
    if (result.status === "aborted") return;
    commitSessionUser(requestEpoch, result.user);
}

function startSessionFetch(
    requestEpoch: number,
): Promise<{ requestEpoch: number; result: SessionFetchResult }> {
    if (inflightFetch && inflightEpoch === requestEpoch) {
        return inflightFetch;
    }

    abortInflightSessionFetch();

    const controller = new AbortController();
    inflightAbort = controller;
    inflightEpoch = requestEpoch;

    inflightFetch = fetchServerUser(controller.signal)
        .then((result) => ({ requestEpoch, result }))
        .finally(() => {
            if (inflightAbort === controller) {
                inflightAbort = null;
            }
            if (inflightEpoch === requestEpoch) {
                inflightFetch = null;
                inflightEpoch = null;
            }
        });

    return inflightFetch;
}

function refreshSession(): void {
    const requestEpoch = sessionEpoch;
    void startSessionFetch(requestEpoch).then(({ requestEpoch: epoch, result }) => {
        applySessionFetch(epoch, result);
    });
}

/**
 * Re-read the WorkOS session and notify every subscriber.
 * Password sign-in only `router.refresh()`es — it does not remount chrome —
 * and a client navigation onto a `/jobs?...` deep link must not keep painting
 * the previous account from the last resolved epoch.
 */
export function revalidateClientSession(): void {
    if (applyingSignOut) return;
    resolvedEpoch = null;
    refreshSession();
}

function registerPageshowRevalidation(): void {
    if (pageshowRegistered || typeof window === "undefined") return;
    pageshowRegistered = true;
    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        if (isSignedOutMarkerSet()) {
            // Drop the frozen epoch so an in-flight session GET from before
            // sign-out cannot commit the old account and clear the marker.
            sessionEpoch += 1;
            abortInflightSessionFetch();
            resolvedEpoch = null;
            resolvedUser = null;
            notifyAuthListeners(null);
        } else {
            resolvedEpoch = null;
        }
        refreshSession();
    });
}

/**
 * Listen for auth state — the app's single client-side auth chokepoint (~20
 * surfaces subscribe here). There is no client-side listener any more (no SDK
 * holds the session), so every real answer comes from asking the server.
 *
 * Also receives immediate `null` from `signOut()` so mounted surfaces drop
 * account chrome before navigation finishes — module caches alone would
 * otherwise keep painting the previous session on /jobs deep links.
 */
export function onAuthChange(callback: (user: ServerUser | null) => void): () => void {
    const mock = e2eMockUser();
    if (mock) {
        callback(mock);
        return () => {};
    }

    registerPageshowRevalidation();
    authListeners.add(callback);

    // Replay a confirmed account immediately so a returning user does not see
    // a Sign-in flash. A cached null is NOT replayed — that was the ghost
    // chrome path (stale "signed out" is fine; stale "signed in" is not).
    // After sign-out, bfcache must not replay the previous account either.
    if (isSignedOutMarkerSet()) {
        callback(null);
    } else if (resolvedEpoch === sessionEpoch && resolvedUser) {
        callback(resolvedUser);
    }

    // Always re-check the live cookie. Deep links and late subscribers must
    // not keep a user this epoch already dropped.
    void startSessionFetch(sessionEpoch).then(({ requestEpoch, result }) => {
        applySessionFetch(requestEpoch, result);
    });

    return () => {
        authListeners.delete(callback);
    };
}

function submitSignOutForm(): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/signout";
    document.body.appendChild(form);
    form.submit();
}

/**
 * Sign out. Hits the one route every provider's session cookie funnels
 * through (`/auth/signout`, backed by WorkOS AuthKit's own `signOut`) —
 * unconditionally, since the route is harmless with no session and asking
 * first would mean trusting the same client-side view that might be wrong.
 *
 * Navigation is a document POST so Set-Cookie deletions apply and the 303
 * to WorkOS logout revokes the refresh token. Callers must not redirect after.
 */
export async function signOut() {
    applyingSignOut = true;
    sessionEpoch += 1;
    abortInflightSessionFetch();
    resolvedEpoch = null;

    const signOutEpoch = sessionEpoch;
    const { clearSessionClientStores } = await import("@/lib/auth/session-client-stores");
    clearSessionClientStores();
    commitSessionUser(signOutEpoch, null);

    if (typeof document === "undefined") {
        applyingSignOut = false;
        return;
    }

    setSignedOutMarker();
    submitSignOutForm();
}
