/**
 * Post-auth provisioning — the class fix for spec decision §4.
 *
 * Before this module, the welcome email existed ONLY in
 * `POST /api/auth/session`'s `after()` block (Firebase's session-cookie
 * route). That was already the one place every PROVIDER shared under
 * Firebase, but the WorkOS migration adds a real gap: the hosted-flow
 * callback (`src/app/auth/callback/route.ts`, Google/passkey/magic-auth) never
 * ran that route at all, so those users got no welcome email.
 * `provisionAppAccess` is the one place all three entry points — password
 * sign-in, password signup, and the hosted-flow `onSuccess` hook — call, so a
 * user is covered by construction regardless of which door they used.
 *
 * Also folds in the org-membership + `metadata.apps` tag every intervu user
 * must carry (spec §3, §8): a hosted-flow user WorkOS created on the fly
 * during Google/passkey sign-in has never been touched by
 * `migrate-firebase-to-workos.ts`, so nothing has tagged them "intervu" or
 * put them in the "Intervu" organization. Checked first via the cheap,
 * already-on-hand `metadata.apps` field — the network calls only run for a
 * user who actually needs them.
 *
 * Every step here is independently idempotent (`sendWelcomeEmailOnce`'s
 * Firestore claim doc, `ensureMembership`'s existence check, and the
 * `hasApp` guard below), so calling this unconditionally on every sign-in is
 * safe and self-heals any account this migration couldn't reach directly.
 */
import type { User } from "@workos-inc/node";
import { hasApp, mergeApps, APP_INTERVU } from "./workos-apps";
import { ensureOrganization, ensureMembership, INTERVU_ORGANIZATION_NAME, createClient, type WorkosClient } from "./workos-sync";
import { sendWelcomeEmailOnce, type WelcomeSendResult } from "@/lib/email/welcome";

export interface ProvisioningDeps {
  syncClient: WorkosClient;
  updateUserMetadata(userId: string, metadata: Record<string, string>): Promise<unknown>;
  sendWelcomeEmailOnce(uid: string, email: string | null | undefined): Promise<WelcomeSendResult>;
}

/** Real deps, built lazily so importing this module never touches the
 *  network or the ESM-only WorkOS SDK at load time (mirrors the dynamic
 *  `import("@workos-inc/authkit-nextjs")` pattern in server-user.ts). */
export async function realProvisioningDeps(): Promise<ProvisioningDeps> {
  const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
  const userManagement = getWorkOS().userManagement;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) throw new Error("WORKOS_API_KEY is not set");
  return {
    syncClient: createClient(apiKey),
    updateUserMetadata: (userId, metadata) => userManagement.updateUser({ userId, metadata }),
    sendWelcomeEmailOnce,
  };
}

/**
 * Ensure `user` has everything a first-class intervu account needs. Safe to
 * call on every sign-in/signup — see module doc for why each step no-ops
 * cheaply once already done.
 */
export async function provisionAppAccess(deps: ProvisioningDeps, user: Pick<User, "id" | "externalId" | "email" | "metadata">): Promise<void> {
  const uid = user.externalId || user.id;

  await deps.sendWelcomeEmailOnce(uid, user.email);

  if (hasApp(user.metadata?.apps, APP_INTERVU)) return;

  try {
    const org = await ensureOrganization(deps.syncClient, INTERVU_ORGANIZATION_NAME);
    await ensureMembership(deps.syncClient, user.id, org.id);
    await deps.updateUserMetadata(user.id, {
      ...user.metadata,
      apps: mergeApps(user.metadata?.apps, APP_INTERVU),
    });
  } catch (err) {
    // Membership/tag repair is best-effort: it self-heals on the user's next
    // sign-in (the `hasApp` guard above re-checks every time), and failing
    // the whole provisioning call over it would be worse than leaving the
    // gap for one more sign-in — the welcome email already landed.
    console.error("[provisioning] membership/tag ensure failed:", err);
  }
}
