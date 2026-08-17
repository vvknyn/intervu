/**
 * The welcome email's once-per-account sender.
 *
 * There is no "account created" hook to hang this on. Password signup mints
 * its profile in `signUp` (actions/auth.ts) but Google sign-in creates NO
 * profile document at all — it goes client-side through `signInWithPopup`
 * and lands server-side only at `POST /api/auth/session`. That route is the
 * one place BOTH providers pass through, so "first session we've ever seen
 * for this uid" is the only definition of "new user" the server can actually
 * observe. This module owns that claim.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { getSiteUrl } from "@/lib/seo/constants";
import { isMintedLoginEmail } from "@/lib/auth/username-email";
import { normalizeEmail } from "./normalize-email";
import { signUnsubscribeToken } from "./unsubscribe-token";
import { sendEmail, type SendEmailResult } from "./send";
import { buildWelcomeEmail } from "./templates/welcome";

const COLLECTION = "welcome_emails";

/** Firestore's gRPC status for "document already exists" on `.create()`. */
const ALREADY_EXISTS = 6;

export type WelcomeSkipReason =
  | "no-email"
  | "minted-login-email"
  | "already-claimed"
  | "missing-unsubscribe-url";

/**
 * Pure: may this address receive a welcome at all, before any I/O? Same
 * shape and role as `resolveSendPreflight` (send.ts) — the branch a test
 * most needs to pin is the one that can't be observed from outside, and a
 * pure function makes both directly assertable without Firestore.
 *
 * `minted-login-email` is the load-bearing one. `usernameEmail` synthesizes
 * `<username>@intervu.cc` for every password account (see
 * lib/auth/username-email.ts); there is no mailbox behind it, so sending
 * there is a guaranteed hard bounce. Bounces are not a private failure —
 * they are the single largest input to a sending domain's reputation, so
 * one welcome email to a minted address degrades deliverability for every
 * digest that follows it.
 */
export function resolveWelcomeEligibility(email: string | null | undefined): WelcomeSkipReason | null {
  if (!email) return "no-email";
  if (isMintedLoginEmail(email)) return "minted-login-email";
  return null;
}

/**
 * Atomically claim the single welcome send for `uid`. `.create()` fails when
 * the document already exists, which makes the claim itself the lock — two
 * concurrent sign-ins (two tabs, a retried request) cannot both win, where a
 * read-then-write would happily let both through and send twice.
 *
 * An UNKNOWN write error also declines. That is deliberate and it is not a
 * silent success: it is logged, and of the two ways to be wrong here —
 * "someone misses a welcome email" versus "someone gets the same email
 * repeatedly" — only the second is visible to the user and reportable as
 * spam. Declining on uncertainty is the recoverable direction.
 */
async function claimWelcomeSend(uid: string, email: string): Promise<boolean> {
  try {
    await getAdminDb().collection(COLLECTION).doc(uid).create({
      email: normalizeEmail(email),
      claimed_at: new Date().toISOString(),
    });
    return true;
  } catch (err: unknown) {
    if ((err as { code?: number })?.code === ALREADY_EXISTS) return false;
    console.error(`[email] welcome claim failed for uid=${uid}:`, err);
    return false;
  }
}

/**
 * Release a claim whose send never actually landed, so a later sign-in can
 * try again. Without this, a single misconfigured env var or one transient
 * Resend error would consume the account's only welcome attempt forever —
 * the claim is meant to prevent DUPLICATES, not to record an email that was
 * never delivered.
 *
 * `suppressed` is deliberately NOT released: that send was correctly
 * consumed by a user who asked not to hear from us, and re-attempting it on
 * every subsequent sign-in would be a retry loop against someone's explicit
 * opt-out.
 */
async function releaseWelcomeClaim(uid: string): Promise<void> {
  await getAdminDb()
    .collection(COLLECTION)
    .doc(uid)
    .delete()
    .catch((err) => console.error(`[email] welcome claim release failed for uid=${uid}:`, err));
}

export type WelcomeSendResult = SendEmailResult | { sent: false; reason: WelcomeSkipReason };

/**
 * Send the welcome email for `uid`, at most once, ever. Never throws — it
 * runs from `after()` on the sign-in route, where an exception would be an
 * unhandled rejection in a request that has already returned 200.
 */
export async function sendWelcomeEmailOnce(uid: string, email: string | null | undefined): Promise<WelcomeSendResult> {
  const ineligible = resolveWelcomeEligibility(email);
  if (ineligible) return { sent: false, reason: ineligible };

  // Scoped to "all", NOT to "welcome". A kind-scoped opt-out would be a dark
  // pattern here by accident: the welcome email never repeats, so suppressing
  // only its own kind changes nothing the reader can observe, while leaving
  // the weekly digest — the one recurring email — still switched on. Nobody
  // clicking unsubscribe on an introduction email means "send me no more
  // introductions"; they mean stop. `isSuppressed` treats an "all" entry as
  // blocking every kind, so this still prevents a second welcome too.
  const token = signUnsubscribeToken(email!, "all");
  if (!token) return { sent: false, reason: "missing-unsubscribe-url" };
  const unsubscribeUrl = `${getSiteUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;

  if (!(await claimWelcomeSend(uid, email!))) return { sent: false, reason: "already-claimed" };

  const result = await sendEmail({
    to: email!,
    kind: "welcome",
    unsubscribeUrl,
    ...buildWelcomeEmail({ siteUrl: getSiteUrl(), unsubscribeUrl }),
  });

  if (!result.sent && result.reason !== "suppressed") await releaseWelcomeClaim(uid);
  return result;
}
