/**
 * An emailed verify link (search alert, follow-by-email) proves ownership of
 * the address, so consuming one is also the passwordless signup/sign-in:
 * find or create the WorkOS account for that email, then open a session via
 * Magic Auth. The alert/follow itself stays keyed by email (intervu.identities),
 * which is what attaches it to the account.
 */
import { after } from "next/server";
import type { User } from "@workos-inc/node";
import { getSiteUrl } from "@/lib/seo/constants";
import { checkUsernameAvailability } from "@/actions/auth";
import { deriveUsername } from "./derive-username";
import { realAuthActionDeps, type AuthActionDeps } from "./auth-action-deps";
import { provisionAppAccess } from "./provisioning";

type Deps = { isUsernameTaken(username: string): Promise<boolean> } & Pick<
  AuthActionDeps,
  | "findUserByEmail"
  | "createUser"
  | "deleteUser"
  | "createProfile"
  | "createMagicAuth"
  | "authenticateWithMagicAuth"
  | "saveSession"
>;

/** The signed-in user, or null when the session could not be established (logged, never fabricated). */
export async function signInVerifiedEmail(deps: Deps, email: string): Promise<User | null> {
  try {
    if (!(await deps.findUserByEmail(email))) {
      const username = await deriveUsername(email, deps.isUsernameTaken);
      const created = await deps.createUser({ email, emailVerified: true, metadata: { username } });
      // A user without a profile would block the next attempt: undo it.
      await deps.createProfile(created.id, username).catch(async (error) => {
        await deps.deleteUser(created.id).catch((e) => console.error("[Auth] rollback failed:", e));
        throw error;
      });
    }
    const { code } = await deps.createMagicAuth({ email });
    const auth = await deps.authenticateWithMagicAuth({ email, code });
    await deps.saveSession(auth, getSiteUrl());
    return auth.user;
  } catch (error) {
    console.error("[Auth] verified-email sign-in failed:", error);
    return null;
  }
}

/** Route-level entry: real deps + deferred provisioning (welcome email, org tag). */
export async function establishSessionForVerifiedEmail(email: string): Promise<void> {
  try {
    const deps = await realAuthActionDeps();
    const isUsernameTaken = async (u: string) => !(await checkUsernameAvailability(u)).available;
    const user = await signInVerifiedEmail({ ...deps, isUsernameTaken }, email);
    if (user) after(() => provisionAppAccess(deps.provisioning, user, "MagicAuth").catch((e) => console.error("[Auth] provisioning failed:", e)));
  } catch (error) {
    console.error("[Auth] verified-email session unavailable:", error);
  }
}
