/**
 * Who is signed in, according to the server.
 *
 * This is the one place that answers that question. Every server action, route
 * handler and server component goes through `getServerUser()`, so swapping the
 * identity provider underneath is a change to this file rather than to the
 * ~32 places that ask.
 *
 * During the Firebase → WorkOS transition it reads BOTH:
 *
 *   1. a WorkOS AuthKit session, for anyone who has signed in since the cutover
 *   2. a Firebase session cookie, for anyone still holding one
 *
 * That is a transition, not a fallback in the bad sense — neither branch
 * invents a user when the other fails. Each reads a real, currently-valid
 * session, and a request carrying neither is genuinely signed out. Firebase
 * session cookies last 14 days, so once every issued cookie has expired the
 * Firebase branch (and this comment) can be deleted without touching a single
 * caller.
 *
 * The uid rule that keeps a migrated user attached to their data lives in
 * `workos-identity.ts`, which has no imports and therefore has tests.
 */

import { getFirebaseServerUser } from "@/lib/firebase/auth-session";
import { toServerUser, type ServerUser } from "@/lib/auth/workos-identity";

export type { ServerUser };

async function getWorkosServerUser(): Promise<ServerUser | null> {
  try {
    // Loaded on use, not at module scope. `@workos-inc/authkit-nextjs` is
    // ESM-only, and this module is imported by ~32 files across actions,
    // routes and pages — a static import puts it in the graph of all of
    // them, which breaks every unit test that touches any of those files
    // at IMPORT time, before a single assertion runs. `getServerUser` is
    // already async, so deferring costs nothing: Node caches the module
    // after the first call.
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const { user } = await withAuth();
    if (!user) return null;
    return toServerUser(user);
  } catch {
    // `withAuth()` throws on a route the AuthKit middleware does not cover.
    // Treating that as "signed out" is correct for the caller — it must not
    // take down a page that renders perfectly well for a guest.
    return null;
  }
}

/**
 * The current user, or null when nobody is signed in.
 *
 * Callers must not care which provider answered, and nothing in the return
 * shape tells them.
 */
export async function getServerUser(): Promise<ServerUser | null> {
  return (await getWorkosServerUser()) ?? (await getFirebaseServerUser());
}
