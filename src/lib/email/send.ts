/**
 * The one chokepoint every email send goes through. Mirrors
 * `PostHogProvider.tsx`'s absent-key posture exactly: no `RESEND_API_KEY`
 * means no client is ever constructed, no network call is ever attempted,
 * and the caller gets back a normal (never thrown) result it can log or
 * ignore — never a fake "sent". Never throws: this runs inline in Server
 * Action / route-handler paths that must not fail a user's request because
 * an email happened to error out.
 */
import { Resend } from "resend";
import type { ReactNode } from "react";
import { emailKindPolicy, type EmailKind } from "./types";
import { isSuppressed } from "./suppression";
import { normalizeEmail } from "./normalize-email";
import { isMintedLoginEmail } from "@/lib/auth/username-email";

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Exactly one of `react`/`html` should be given — `text` is required
   *  regardless (every send needs a plain-text alternative). */
  react?: ReactNode;
  html?: string;
  text: string;
  kind: EmailKind;
  /** Required when `emailKindPolicy(kind).requiresUnsubscribeHeader` is
   *  true — the caller (send.ts's own callers: the digest sender, the
   *  waitlist confirmation) builds it via `unsubscribe-token.ts` + the
   *  `/unsubscribe` route. */
  unsubscribeUrl?: string;
}

export type SendSkipReason = "no-api-key" | "no-mailbox" | "missing-from-address" | "missing-unsubscribe-url";
export type SendEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: SendSkipReason | "suppressed" | "send-error" };

/**
 * Pure: decides whether `sendEmail` should even attempt a send, before any
 * I/O (Firestore suppression lookup, network call) — no `process.env`
 * reads in here, the caller resolves those first so this is a plain,
 * directly unit-testable function. `no-api-key` is checked first (cheapest,
 * matches PostHogProvider's "absent key = no-op before anything else"
 * posture); the unsubscribe-header requirement is checked before the
 * from-address so a misconfigured non-transactional send never gets as far
 * as "just needs a from address" in test output.
 *
 * Takes the recipient itself rather than a `isMinted` boolean the caller
 * computes: a boolean can be passed wrong, and every caller computing it
 * separately is how the welcome email ended up guarded while the digest —
 * the RECURRING one — was not (caught by a dry run, 2026-08-17).
 */
export function resolveSendPreflight(input: {
  hasApiKey: boolean;
  hasFrom: boolean;
  hasUnsubscribeUrl: boolean;
  to: string;
  kind: EmailKind;
}): SendSkipReason | null {
  if (!input.hasApiKey) return "no-api-key";
  // Checked before the config branches because this is a fact about the
  // RECIPIENT, not a misconfiguration — reporting "no mailbox exists" as
  // "missing-from-address" would send someone to fix the wrong thing.
  // Password signup mints <username>@intervu.cc with nothing behind it, so
  // every send there is a hard bounce, and bounce rate is the largest
  // single input to a sending domain's reputation.
  if (isMintedLoginEmail(input.to)) return "no-mailbox";
  if (emailKindPolicy(input.kind).requiresUnsubscribeHeader && !input.hasUnsubscribeUrl) {
    return "missing-unsubscribe-url";
  }
  if (!input.hasFrom) return "missing-from-address";
  return null;
}

let client: Resend | null | undefined;

/** Cached singleton, same lazy-init shape as `getAdminDb`/`getAdminApp` —
 *  undefined = not yet checked, null = checked and no key. */
function getResendClient(): Resend | null {
  if (client !== undefined) return client;
  const apiKey = process.env.RESEND_API_KEY;
  client = apiKey ? new Resend(apiKey) : null;
  if (!client) {
    console.log("[email] RESEND_API_KEY not set — sends no-op.");
  }
  return client;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const policy = emailKindPolicy(input.kind);
  const to = normalizeEmail(input.to);
  const resend = getResendClient();
  const from = process.env.RESEND_FROM;

  const skip = resolveSendPreflight({
    hasApiKey: resend !== null,
    hasFrom: Boolean(from),
    hasUnsubscribeUrl: Boolean(input.unsubscribeUrl),
    to,
    kind: input.kind,
  });
  if (skip) {
    if (skip !== "no-api-key") {
      console.error(`[email] refusing to send kind=${input.kind} to ${to}: ${skip}`);
    }
    return { sent: false, reason: skip };
  }

  if (policy.suppressible && (await isSuppressed(to, input.kind))) {
    console.log(`[email] skipped kind=${input.kind} to ${to}: suppressed`);
    return { sent: false, reason: "suppressed" };
  }

  const headers: Record<string, string> | undefined = policy.requiresUnsubscribeHeader
    ? {
        "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;

  try {
    // Non-null by construction: `resolveSendPreflight` only returns null
    // (proceed) when `hasApiKey`/`hasFrom` were both true.
    const { data, error } = await resend!.emails.send({
      from: from!,
      to,
      subject: input.subject,
      ...(input.react ? { react: input.react } : {}),
      ...(input.html ? { html: input.html } : {}),
      text: input.text,
      headers,
    });

    if (error) {
      console.error(`[email] send failed kind=${input.kind} to ${to}:`, error);
      return { sent: false, reason: "send-error" };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error(`[email] send threw kind=${input.kind} to ${to}:`, err);
    return { sent: false, reason: "send-error" };
  }
}
