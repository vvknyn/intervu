import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";

/**
 * GET /api/auth/session — who is signed in, according to the server.
 *
 * The client cannot answer this for itself any more. WorkOS AuthKit sessions
 * live in an httpOnly cookie, so `client-auth.ts`'s `fetchServerUser` (the
 * fallback `onAuthChange`/`getCurrentUser` reach for once the e2e mock is
 * ruled out) has no other way to learn who is signed in. `getServerUser()` is
 * the one place that answers that question, and this exposes it to the
 * browser.
 *
 * Returns only what the client actually renders — uid, email, display name,
 * profile picture URL. Never a token: the session cookie is httpOnly
 * precisely so script cannot reach it, and handing back a credential here
 * would undo that.
 *
 * POST (mint a session from a Firebase ID token) and DELETE (clear the
 * Firebase session cookie) were retired with Firebase Auth (2026-08-27
 * WorkOS migration) — signing in now goes through `actions/auth.ts`'s
 * `signIn`/`signUp` or the `/auth/callback` hosted-flow route, both of which
 * call WorkOS AuthKit's own `saveSession` directly; signing out goes through
 * `/auth/signout`.
 */
export async function GET() {
    const user = await getServerUser();
    return NextResponse.json(
        { user },
        // Identity is per-request and per-cookie. A cached copy of this
        // response served to a second person is an account takeover, so it
        // must never sit in a CDN or the browser's http cache.
        { headers: { "Cache-Control": "no-store, private" } },
    );
}
