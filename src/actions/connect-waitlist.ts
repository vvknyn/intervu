"use server";

import { z } from "zod";
import { validate } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebase/admin";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowConnectWaitlistRequest, allowConnectWaitlistSubmit } from "@/lib/shield/rate-limit";
import { turnstileRejectMessage, verifyTurnstile } from "@/lib/shield/turnstile";
import { EMAIL_FORM_INVALID_MESSAGE, emailFormRateLimitMessage } from "@/lib/shield/email-form-refusals";
import { logServer } from "@/lib/observability/posthog-logs";
import { CONNECT_CLIENTS, CONNECT_CLIENT_IDS } from "@/lib/connect-clients";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist-confirmation";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

/**
 * Waitlist capture for /connect (MCP pairing is live; this collects "notify
 * me" requests for surfaces that aren't yet — e.g. the OpenClaw local agent
 * on non-Mac platforms). Dedup is an idempotent upsert keyed on
 * the normalized email as the Firestore doc id, so resubmission just
 * re-merges the same doc instead of racing a query-then-write check.
 *
 * Shield: a per-IP flood guard (`allowConnectWaitlistSubmit`), Turnstile,
 * then the per-IP write budget (`allowConnectWaitlistRequest`) — all before
 * this ever touches Firestore, same "fail before the backend" shape as
 * `searchJobsAction` in actions/jobs.ts. Why two limits: lib/shield/rate-limit.ts.
 */
const connectWaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "email is too long").email("must be a valid email"),
  // Derived from CONNECT_CLIENTS (src/lib/connect-clients.ts) — the /connect
  // tabs are the only valid values a submission can carry.
  client: z.enum(CONNECT_CLIENT_IDS),
});

/** The way in no limit or check covers; ends every refusal that has one. */
const SUPPORT_OFFER = `email us at ${PUBLIC_SUPPORT_EMAIL} and we'll add you.`;

/** Every refusal after the email check goes to PostHog Logs (no email in it), so a real person meeting one shows up. */
function logWaitlistRefused(reason: string, attrs: Record<string, string> = {}): void {
  logServer("warn", `waitlist refused: ${reason}`, { reason, form: "connect_waitlist", ...attrs });
}

export async function joinConnectWaitlist(input: {
  email: string;
  client: string;
  turnstileToken?: string;
}): Promise<{ error?: string; success?: true }> {
  const parsed = validate(connectWaitlistSchema, input);
  // `client` is fixed by the page, so a failure here is the visitor's email.
  if (!parsed.ok) return { error: EMAIL_FORM_INVALID_MESSAGE };

  const ip = await getClientIp();
  if (!allowConnectWaitlistSubmit(ip)) {
    logWaitlistRefused("rate_limited_submit");
    return { error: emailFormRateLimitMessage(allowConnectWaitlistSubmit.retryAfterMs(ip), SUPPORT_OFFER) };
  }

  const turnstile = await verifyTurnstile(input.turnstileToken, ip);
  if (turnstile.status === "reject") {
    logWaitlistRefused("turnstile", { turnstile_reason: turnstile.reason });
    return { error: turnstileRejectMessage(turnstile.reason) };
  }

  // Counted only now, for a submit that is about to write: a refused
  // security check or a malformed email never spends this budget.
  if (!allowConnectWaitlistRequest(ip)) {
    logWaitlistRefused("rate_limited_write");
    return { error: emailFormRateLimitMessage(allowConnectWaitlistRequest.retryAfterMs(ip), SUPPORT_OFFER) };
  }

  try {
    const db = getAdminDb();
    const ref = db.collection("connect_waitlist").doc(parsed.data.email);
    const existing = await ref.get();

    await ref.set(
      {
        email: parsed.data.email,
        client: parsed.data.client,
        created_at: new Date().toISOString(),
      },
      { merge: true },
    );

    // Idempotent: only the first submission for this email sends a
    // confirmation, regardless of how many times the form resubmits.
    if (!existing.data()?.confirmationSentAt) {
      const clientLabel = CONNECT_CLIENTS.find((c) => c.id === parsed.data.client)?.label ?? parsed.data.client;
      const sendResult = await sendWaitlistConfirmation(parsed.data.email, `${clientLabel} on /connect`);
      if (sendResult.sent) {
        await ref.set({ confirmationSentAt: new Date().toISOString() }, { merge: true });
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error joining connect waitlist:", error);
    return {
      error: `Couldn't save that — ${SUPPORT_OFFER}`,
    };
  }
}
