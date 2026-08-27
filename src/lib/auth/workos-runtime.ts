/**
 * Thin, dependency-injectable access to the WorkOS SDK for runtime (not
 * migration-script) code.
 *
 * `getWorkosUserManagement` wraps the dynamic `import("@workos-inc/authkit-nextjs")`
 * pattern already used by `server-user.ts` and `auth/start/route.ts` — the
 * package is ESM-only, and a static top-level import breaks the test runner
 * for every file that transitively imports it, so the import is deferred to
 * call time instead.
 */
import type { User, WorkOS } from "@workos-inc/node";
import { hasApp, APP_INTERVU } from "./workos-apps";

/** The SDK never exports its `UserManagement` class by name — this pulls the
 *  real, full-featured type structurally off `WorkOS`, which IS exported,
 *  rather than guessing at an internal name (`PublicUserManagement` is a
 *  different, unrelated narrower type the bundler happens to also export). */
export type WorkosUserManagement = WorkOS["userManagement"];

export async function getWorkosUserManagement(): Promise<WorkosUserManagement> {
  const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
  return getWorkOS().userManagement;
}

/**
 * Every WorkOS user tagged for this product — the single source of truth
 * behind `email/verify`'s lookup, the digest's eligible-uid walk, and the
 * admin People census, replacing each one's separate Firebase `listUsers()`
 * page-walk now that Firebase Auth is retired.
 *
 * Filters on `metadata.apps` (via `hasApp`/`APP_INTERVU`, the same mechanism
 * `provisionAppAccess` writes), not organization membership — membership
 * repair is best-effort and self-heals on next sign-in (see
 * `provisioning.ts`), so it can lag behind the tag for an account that hasn't
 * signed in again yet. One environment now serves two products (see
 * `workos-apps.ts`), so an unfiltered `listUsers()` would double-count the
 * other product's accounts.
 *
 * `listUsers` returns an `AutoPaginatable` — `.autoPagination()` walks every
 * page for us, so callers don't hand-roll their own page loop.
 */
export async function listIntervuUsers(
  userManagement: Pick<WorkosUserManagement, "listUsers">,
): Promise<User[]> {
  const page = await userManagement.listUsers({ order: "asc" });
  const all = await page.autoPagination();
  return all.filter((user) => hasApp(user.metadata?.apps, APP_INTERVU));
}

export function requireWorkosClientId(): string {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) throw new Error("WORKOS_CLIENT_ID is not set");
  return clientId;
}

/**
 * A `ServerUser.uid` (see `workos-identity.ts`'s `toServerUser`) is
 * `externalId || id` — for a user migrated from Firebase/Supabase that's the
 * OLD system's id, not the WorkOS user id `deleteUser`/`updateUser` require.
 * For a user created directly in WorkOS (no externalId), `uid` already IS the
 * WorkOS id.
 *
 * Tries the external-id lookup first and falls back to treating `uid` as a
 * raw WorkOS id when that lookup finds nothing — `getUserByExternalId`
 * rejects (typically `NotFoundException`) rather than returning null, so the
 * fallback is a catch, not a null-check. A genuinely wrong id still fails
 * safely: the caller's own WorkOS call (`deleteUser`/`updateUser`) then
 * throws `NotFoundException` rather than silently acting on nothing.
 */
export async function resolveWorkosUserId(
  getByExternalId: (externalId: string) => Promise<User>,
  uid: string,
): Promise<string> {
  try {
    const user = await getByExternalId(uid);
    return user.id;
  } catch {
    return uid;
  }
}
