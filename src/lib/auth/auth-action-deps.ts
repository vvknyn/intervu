/**
 * The dependency shape `actions/auth.ts`'s core functions (`signUpCore`,
 * `signInCore`) are tested against, and the one place that assembles the
 * REAL version of it.
 *
 * Same deps-first-argument convention as `actions/email-follow.ts`'s
 * `ContactCookieFollowDeps` — the interesting decisions (which WorkOS error
 * maps to which message, whether provisioning runs, whether a failed
 * profile write rolls the WorkOS user back) become unit-testable against a
 * fake, and the "use server" action wrappers exist only to hand this real
 * version to the core function.
 *
 * `Pick<AuthActionDeps, …>` at each call site (interface segregation, same
 * as `ProvisioningDeps`'s callers) keeps a core function's signature to only
 * what it actually calls — `signInCore` never sees `createUser`, `deleteAccount`
 * never sees `createPasswordReset`.
 */
import type { User, AuthenticationResponse } from "@workos-inc/node";
import { getWorkosUserManagement, requireWorkosClientId } from "./workos-runtime";
import { realProvisioningDeps, type ProvisioningDeps } from "./provisioning";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

export interface AuthActionDeps {
  createUser(options: { email: string; password?: string; emailVerified?: boolean; metadata: Record<string, string> }): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  createMagicAuth(options: { email: string }): Promise<{ code: string }>;
  authenticateWithMagicAuth(options: { email: string; code: string }): Promise<AuthenticationResponse>;
  deleteUser(userId: string): Promise<void>;
  getUserByExternalId(externalId: string): Promise<User>;
  authenticateWithPassword(options: { email: string; password: string }): Promise<AuthenticationResponse>;
  authenticateWithEmailVerification(options: { code: string; pendingAuthenticationToken: string }): Promise<AuthenticationResponse>;
  /** Emails a fresh verification code to the account with this address. */
  resendVerificationEmail(email: string): Promise<void>;
  createPasswordReset(options: { email: string }): Promise<{ passwordResetToken: string }>;
  resetPassword(options: { token: string; newPassword: string }): Promise<void>;
  saveSession(authResponse: AuthenticationResponse, url: string): Promise<void>;
  /** Writes the Firestore `profiles/<workosUserId>` doc a fresh signup needs.
   *  Kept in this deps object (rather than called directly by `signUpCore`)
   *  so the rollback-on-profile-failure branch is exercisable without
   *  Firestore. */
  createProfile(workosUserId: string, username: string): Promise<void>;
  sendPasswordResetEmail(input: { email: string; resetUrl: string }): Promise<unknown>;
  provisioning: ProvisioningDeps;
}

/** Real deps, built lazily — importing this module never touches the
 *  network or the ESM-only WorkOS/AuthKit SDKs at load time (same reason as
 *  `provisioning.ts`'s `realProvisioningDeps`). */
export async function realAuthActionDeps(): Promise<AuthActionDeps> {
  const userManagement = await getWorkosUserManagement();
  const { saveSession } = await import("@workos-inc/authkit-nextjs");
  const clientId = requireWorkosClientId();

  return {
    createUser: (options) => userManagement.createUser(options),
    findUserByEmail: async (email) => (await userManagement.listUsers({ email })).data[0] ?? null,
    createMagicAuth: (options) => userManagement.createMagicAuth(options),
    authenticateWithMagicAuth: (options) => userManagement.authenticateWithMagicAuth({ clientId, ...options }),
    deleteUser: (userId) => userManagement.deleteUser(userId),
    getUserByExternalId: (externalId) => userManagement.getUserByExternalId(externalId),
    authenticateWithPassword: (options) => userManagement.authenticateWithPassword({ clientId, ...options }),
    authenticateWithEmailVerification: (options) => userManagement.authenticateWithEmailVerification({ clientId, ...options }),
    resendVerificationEmail: async (email) => {
      const { data } = await userManagement.listUsers({ email });
      if (!data[0]) throw new Error("no account for this address");
      await userManagement.sendVerificationEmail({ userId: data[0].id });
    },
    createPasswordReset: (options) => userManagement.createPasswordReset(options),
    resetPassword: async (options) => {
      await userManagement.resetPassword(options);
    },
    saveSession,
    createProfile: async (workosUserId, username) => {
      await getAdminDb().collection("profiles").doc(workosUserId).set({
        username,
        created_at: new Date().toISOString(),
      });
    },
    sendPasswordResetEmail,
    provisioning: await realProvisioningDeps(),
  };
}
