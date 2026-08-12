/**
 * The one place that knows how to send a waitlist confirmation — both
 * `actions/waitlist.ts` (credit packs) and `actions/connect-waitlist.ts`
 * (per-client "notify me") call this instead of each building their own
 * unsubscribe token + template + send call.
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

  const unsubscribeUrl = `${getSiteUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
  const { subject, html, text } = buildWaitlistConfirmEmail({ whatSignedUpFor, unsubscribeUrl });

  return sendEmail({ to: email, subject, html, text, kind: "waitlist_confirm", unsubscribeUrl });
}
