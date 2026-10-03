"use server";

import { z } from "zod";
import { validate } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebase/admin";
import { getServerUser } from "@/lib/auth/server-user";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowFoundingReserveRequest, allowFoundingReserveSubmit } from "@/lib/shield/rate-limit";
import { turnstileRejectMessage, verifyTurnstile } from "@/lib/shield/turnstile";
import { EMAIL_FORM_INVALID_MESSAGE, emailFormRateLimitMessage } from "@/lib/shield/email-form-refusals";
import { logServer } from "@/lib/observability/posthog-logs";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist-confirmation";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";
import { FOUNDING_WAITLIST_LABEL } from "@/lib/billing/founding-offer";

/**
 * Founding-seat reservation for /pricing while `FOUNDING_MEMBER_CHECKOUT_URL`
 * is unset (no Stripe link yet). Nothing is charged: the row is a place in
 * the first seats and the address that gets the checkout link first. Same
 * shape as `joinConnectWaitlist` (actions/connect-waitlist.ts): validate,
 * a per-IP flood guard, Turnstile, the per-IP write budget, then an
 * idempotent upsert keyed on the normalised email as the Firestore doc id,
 * and one confirmation email (limits: lib/shield/rate-limit.ts).
 *
 * `created_at` is written once and kept on resubmission, because order is
 * the whole point of a founding list; `last_seen_at` moves every time.
 */
const reserveSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "email is too long").email("must be a valid email"),
});

/** The way in no limit or check covers; ends every refusal that has one. */
const SUPPORT_OFFER = `email us at ${PUBLIC_SUPPORT_EMAIL} and we'll hold a seat for you.`;

/** Every refusal after the email check goes to PostHog Logs (no email in it), so a real person meeting one shows up. */
function logReserveRefused(reason: string, attrs: Record<string, string> = {}): void {
  logServer("warn", `founding seat refused: ${reason}`, { reason, form: "founding_seat", ...attrs });
}

export async function reserveFoundingSeat(input: {
  email: string;
  turnstileToken?: string;
}): Promise<{ error?: string; success?: true }> {
  const parsed = validate(reserveSchema, input);
  if (!parsed.ok) return { error: EMAIL_FORM_INVALID_MESSAGE };

  const ip = await getClientIp();
  if (!allowFoundingReserveSubmit(ip)) {
    logReserveRefused("rate_limited_submit");
    return { error: emailFormRateLimitMessage(allowFoundingReserveSubmit.retryAfterMs(ip), SUPPORT_OFFER) };
  }

  const turnstile = await verifyTurnstile(input.turnstileToken, ip);
  if (turnstile.status === "reject") {
    logReserveRefused("turnstile", { turnstile_reason: turnstile.reason });
    return { error: turnstileRejectMessage(turnstile.reason) };
  }

  // Counted only now, for a submit that is about to write: a refused
  // security check or a malformed email never spends this budget.
  if (!allowFoundingReserveRequest(ip)) {
    logReserveRefused("rate_limited_write");
    return { error: emailFormRateLimitMessage(allowFoundingReserveRequest.retryAfterMs(ip), SUPPORT_OFFER) };
  }

  try {
    const db = getAdminDb();
    const user = await getServerUser();
    const now = new Date().toISOString();
    const ref = db.collection("founding_waitlist").doc(parsed.data.email);
    const existing = await ref.get();

    await ref.set(
      {
        email: parsed.data.email,
        source: "/pricing",
        last_seen_at: now,
        ...(existing.exists ? {} : { created_at: now }),
        ...(user ? { uid: user.uid } : {}),
      },
      { merge: true },
    );

    // Idempotent: only the first reservation for this address sends a
    // confirmation, however many times the form resubmits.
    if (!existing.data()?.confirmationSentAt) {
      const sendResult = await sendWaitlistConfirmation(parsed.data.email, FOUNDING_WAITLIST_LABEL);
      if (sendResult.sent) {
        await ref.set({ confirmationSentAt: new Date().toISOString() }, { merge: true });
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error reserving a founding seat:", error);
    return {
      error: `Couldn't save that — ${SUPPORT_OFFER}`,
    };
  }
}
