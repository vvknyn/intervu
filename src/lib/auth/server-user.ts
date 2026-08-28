/**
 * Who is signed in, according to the server.
 *
 * This is the one place that answers that question. Every server action, route
 * handler and server component goes through `getServerUser()`, so swapping the
 * identity provider underneath is a change to this file rather than to the
 * ~32 places that ask.
 *
 * Firebase Auth is retired (2026-08-27 WorkOS migration) — this reads only a
 * WorkOS AuthKit session. Firestore DATA access is untouched; only the
 * session/identity layer moved.
 *
 * The uid rule that keeps a migrated user attached to their data lives in
 * `workos-identity.ts`, which has no imports and therefore has tests.
 */

import { toServerUser, type ServerUser } from "@/lib/auth/workos-identity";

export type { ServerUser };

/**
 * The current user, or null when nobody is signed in.
 */
export async function getServerUser(): Promise<ServerUser | null> {
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
