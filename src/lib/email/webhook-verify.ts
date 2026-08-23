/**
 * Thin wrapper around the Resend SDK's own webhook verifier
 * (`resend.webhooks.verify`, which is really the vendored `standardwebhooks`
 * package — Resend signs with the Standard Webhooks spec, HMAC-SHA256; see
 * `readWebhookSignatureHeaders` for which header names carry it). Reused
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

/**
 * The three values a Standard Webhooks signature is carried in. Exported so the
 * reader below and every caller that reports *which* one went missing share one
 * list instead of re-typing it.
 */
export const SIGNATURE_HEADER_NAMES = ["id", "timestamp", "signature"] as const;

export type SignatureHeaderName = (typeof SIGNATURE_HEADER_NAMES)[number];

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Standard Webhooks defines the canonical names as `webhook-id` /
 * `webhook-timestamp` / `webhook-signature`, but the spec grew out of Svix and
 * every Svix-powered sender still emits the older `svix-` prefix for the same
 * three values — Resend's own verification docs show `svix-id` et al. Reading
 * only the canonical spelling means the headers come back null, the payload is
 * dropped unread, and the sender sees a 401 on every single delivery until it
 * disables the endpoint. That is exactly what happened to us.
 *
 * Both spellings are accepted, canonical first: this is the spec's own
 * compatibility rule, so it covers any Svix-powered provider we add later
 * rather than singling one out.
 */
export function readWebhookSignatureHeaders(headers: Headers): ResendWebhookHeaders {
  const read = (name: SignatureHeaderName) => headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`);
  return { id: read("id"), timestamp: read("timestamp"), signature: read("signature") };
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
