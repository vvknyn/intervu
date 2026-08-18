/**
 * The one place that knows how to send a waitlist confirmation.
 * `actions/connect-waitlist.ts` (per-client "notify me") calls this instead
 * of building its own unsubscribe token + template + send call.
 *
 * A second caller, `actions/waitlist.ts`, sold credit packs and was deleted
 * 2026-08-18: it had zero callers and its confirmation named a price the
 * product cannot charge during beta.
 */
import { getSiteUrl } from "@/lib/seo/constants";
import { signUnsubscribeToken } from "./unsubscribe-token";
import { buildWaitlistConfirmEmail } from "./templates/waitlist-confirm";
import { sendEmail, type SendEmailResult } from "./send";

export async function sendWaitlistConfirmation(
  email: string,
  whatSignedUpFor: string,
): Promise<SendEmailResult> {
  const token = signUnsubscribeToken(email, "waitlist_confirm");
  // No ENCRYPTION_KEY (e.g. this pre-launch dev environment) — same no-op
  // posture as a missing RESEND_API_KEY: without a token there's no working
  // unsubscribe link to include, and a non-transactional send without one
  // is exactly the deliverability mistake this whole PR exists to prevent.
  if (!token) {
    console.log(`[email] skipping waitlist confirmation to ${email}: no ENCRYPTION_KEY to sign an unsubscribe token`);
    return { sent: false, reason: "missing-unsubscribe-url" };
  }

  const siteUrl = getSiteUrl();
  const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  const { subject, html, text } = buildWaitlistConfirmEmail({ whatSignedUpFor, unsubscribeUrl, siteUrl });

  return sendEmail({ to: email, subject, html, text, kind: "waitlist_confirm", unsubscribeUrl });
}
