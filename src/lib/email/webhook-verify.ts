/**
 * Thin wrapper around the Resend SDK's own webhook verifier
 * (`resend.webhooks.verify`, which is really the vendored `standardwebhooks`
 * package — Resend signs with the Standard Webhooks spec: `webhook-id`/
 * `webhook-timestamp`/`webhook-signature` headers, HMAC-SHA256). Reused
 * rather than hand-rolled so `resend` really is the only new dependency
 * this PR adds — `standardwebhooks` arrives transitively and does the
 * timestamp-tolerance + timing-safe comparison work correctly already.
 *
 * `webhooks.verify()` never touches the client's own API key (it's a local
 * HMAC check against `webhookSecret`, no network call) — but the SDK's
 * constructor still throws "Missing API key" when both the constructor arg
 * AND `RESEND_API_KEY` are absent (verified against the installed SDK, not
 * assumed). A placeholder string sidesteps that without touching
 * `RESEND_API_KEY` itself — the webhook receiver must keep working
 * independent of whether the send side has a real key yet.
 */
import { Resend, type WebhookEventPayload } from "resend";

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Returns the parsed event on a valid signature, or null on any failure —
 * missing secret, missing/malformed headers, bad signature, stale
 * timestamp. Never throws: the SDK's verifier throws `WebhookVerificationError`
 * internally, caught here so the route handler has one uniform "did this
 * verify" branch.
 */
export function verifyResendWebhook(
  payload: string,
  headers: ResendWebhookHeaders,
  webhookSecret: string | undefined,
): WebhookEventPayload | null {
  if (!webhookSecret) return null;
  if (!headers.id || !headers.timestamp || !headers.signature) return null;

  try {
    return new Resend(process.env.RESEND_API_KEY || "unused-verify-only").webhooks.verify({
      payload,
      webhookSecret,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
    });
  } catch {
    return null;
  }
}
