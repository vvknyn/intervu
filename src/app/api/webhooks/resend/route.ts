/**
 * Resend webhook receiver — the other half of deliverability. Without this,
 * a hard bounce or spam complaint just keeps getting re-sent to on every
 * future digest/waitlist confirmation until Resend throttles or suspends
 * the sending domain. `RESEND_WEBHOOK_SECRET` absent means we CANNOT tell a
 * real Resend payload from a forged one, so this refuses to process
 * anything rather than trusting an unverified body — same "no key, no
 * action" posture as the send seam, just for the inbound direction.
 */
import { NextResponse } from "next/server";
import { verifyResendWebhook } from "@/lib/email/webhook-verify";
import { suppress } from "@/lib/email/suppression";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET not set — refusing to process.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const event = verifyResendWebhook(
    payload,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    secret,
  );

  if (!event) {
    console.error("[resend webhook] signature verification failed — payload dropped, unprocessed.");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (event.type === "email.bounced" || event.type === "email.complained") {
    const reason = event.type === "email.bounced" ? "bounced" : "complained";
    await Promise.all(event.data.to.map((email) => suppress(email, "all", reason)));
  }

  return NextResponse.json({ received: true });
}
