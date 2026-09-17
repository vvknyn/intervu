/**
 * The marketing send script's one seam for "actually deliver this email."
 *
 * `ResendMarketingTransport` does not open a second Resend client — it
 * calls the repo's existing chokepoint (`sendEmail`, `src/lib/email/send.ts`)
 * with `kind: "marketing_update"`, so a marketing send gets the same
 * suppression check, List-Unsubscribe headers and no-RESEND_API_KEY-no-op
 * posture every other email in the product already gets, instead of a
 * second, slightly-different implementation of all three.
 *
 * Selection is env-driven (`MAIL_TRANSPORT`, default `"dry-run"`) so the
 * send script's own `--live` flag and `MARKETING_SEND_ENABLED` double-lock
 * (scripts/send-marketing-update.ts) are the only things that can make a
 * real send happen — this module never sends without being told to.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sendEmail } from "@/lib/email/send";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Required: every message this transport carries is a suppressible,
   *  List-Unsubscribe-bearing kind (see `types.ts`'s `marketing_update`
   *  policy) — there is no marketing send without one. */
  unsubscribeUrl: string;
}

export interface MailTransport {
  send(msg: MailMessage): Promise<{ id: string }>;
}

const PREVIEW_DIR = path.join(process.cwd(), "tmp", "marketing-preview");

function hashRecipient(to: string): string {
  return createHash("sha256").update(to.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Default transport. Writes the rendered email to disk instead of sending
 * it, so a dry run is the same render path a live send would use, just
 * with delivery swapped out — never a separate reimplementation that could
 * silently drift from what actually goes out. `tmp/` is repo-gitignored.
 */
export class DryRunTransport implements MailTransport {
  async send(msg: MailMessage): Promise<{ id: string }> {
    await fs.mkdir(PREVIEW_DIR, { recursive: true });
    const base = hashRecipient(msg.to);
    await fs.writeFile(path.join(PREVIEW_DIR, `${base}.html`), msg.html, "utf8");
    await fs.writeFile(path.join(PREVIEW_DIR, `${base}.txt`), msg.text, "utf8");
    return { id: `dry-run-${base}` };
  }
}

export class ResendMarketingTransport implements MailTransport {
  async send(msg: MailMessage): Promise<{ id: string }> {
    const result = await sendEmail({
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      kind: "marketing_update",
      unsubscribeUrl: msg.unsubscribeUrl,
    });
    if (!result.sent) {
      throw new Error(`marketing send refused for kind=marketing_update: ${result.reason}`);
    }
    if (!result.id) {
      // sendEmail's `sent: true` branch only omits `id` if Resend's own
      // response did — that is itself a fact worth failing loudly on
      // rather than inventing an id for the send log to record.
      throw new Error("marketing send reported sent=true but Resend returned no message id");
    }
    return { id: result.id };
  }
}

export type MailTransportMode = "dry-run" | "resend";

export function createTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const mode = (env.MAIL_TRANSPORT?.trim() || "dry-run") as MailTransportMode;
  switch (mode) {
    case "dry-run":
      return new DryRunTransport();
    case "resend":
      return new ResendMarketingTransport();
    default:
      throw new Error(`Unknown MAIL_TRANSPORT: "${mode}" (expected "dry-run" or "resend")`);
  }
}
