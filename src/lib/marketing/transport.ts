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
 * `SmtpMarketingTransport` is for sending from a personal mailbox (Proton
 * Mail Bridge on Vivek's laptop) instead of Velai's own sending domain.
 *
 * Selection is env-driven (`MAIL_TRANSPORT`, default `"dry-run"`) so the
 * send script's own `--live` flag and `MARKETING_SEND_ENABLED` double-lock
 * (scripts/send-marketing-update.ts) are the only things that can make a
 * real send happen — this module never sends without being told to.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createTransport as createNodemailerTransport, type Transporter } from "nodemailer";
import { sendEmail } from "@/lib/email/send";
import { isReachableEmail } from "@/lib/auth/minted-email";
import { normalizeEmail } from "@/lib/email/normalize-email";
import { isSuppressed } from "@/lib/email/suppression";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Required: every message this transport carries is a suppressible,
   *  List-Unsubscribe-bearing kind (see `types.ts`'s `marketing_update`
   *  policy) — there is no marketing send without one. */
  unsubscribeUrl: string;
  /** Where replies go (`MARKETING_REPLY_TO`). Required for Resend, whose
   *  sending domain has no inbox; a personal mailbox takes its own replies. */
  replyTo?: string;
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
      replyTo: msg.replyTo,
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

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS from the first byte (port 465). Otherwise STARTTLS is required. */
  secure: boolean;
  user: string;
  pass: string;
  /** The From header, e.g. `Vivek from Velai <vivek@example.com>`. */
  from: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** nodemailer options for `config`. STARTTLS is required unless the
 *  connection is TLS from the start, so the password never crosses in the
 *  clear. Bridge serves a certificate it made itself, so that one is
 *  accepted only when the server is on this machine; anywhere else the
 *  certificate is checked as usual. */
export function smtpTransportOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: LOOPBACK_HOSTS.has(config.host) ? { rejectUnauthorized: false } : undefined,
  };
}

/**
 * Reads the SMTP settings for `MAIL_TRANSPORT=smtp`. Host and port default
 * to Proton Mail Bridge on the same machine (127.0.0.1:1025), which is how a
 * campaign goes out from a personal Proton address: Bridge signs in to
 * Proton and hands the script a local SMTP server. SMTP_USER and SMTP_PASS
 * are the username and password Bridge shows for the account, not the
 * Proton login.
 */
export function smtpConfigFromEnv(env: Record<string, string | undefined> = process.env): SmtpConfig {
  const host = env.SMTP_HOST?.trim() || "127.0.0.1";
  const portRaw = env.SMTP_PORT?.trim() || "1025";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`SMTP_PORT must be a port number, got "${portRaw}"`);
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  const from = env.MARKETING_FROM?.trim();
  const missing = [!user && "SMTP_USER", !pass && "SMTP_PASS", !from && "MARKETING_FROM"].filter(Boolean);
  if (missing.length) throw new Error(`MAIL_TRANSPORT=smtp needs ${missing.join(", ")}`);
  return { host, port, secure: env.SMTP_SECURE === "1" || port === 465, user: user!, pass: pass!, from: from! };
}

/**
 * Sends through any SMTP server, in practice Proton Mail Bridge.
 *
 * `sendEmail` is Resend-only, so the two checks it makes on every send are
 * repeated here rather than skipped: a minted or empty address is refused,
 * and a suppressed address is not sent to even if it unsubscribed after
 * the recipient list was read. The List-Unsubscribe headers match
 * `sendEmail`'s.
 */
export class SmtpMarketingTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(
    readonly config: SmtpConfig,
    transporter?: Transporter,
    private readonly suppressed: (email: string) => Promise<boolean> = (email) => isSuppressed(email, "marketing_update"),
  ) {
    this.transporter = transporter ?? createNodemailerTransport(smtpTransportOptions(config));
  }

  /** Signs in to the SMTP server once, before any recipient is touched. */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(msg: MailMessage): Promise<{ id: string }> {
    const to = normalizeEmail(msg.to);
    if (!isReachableEmail(to)) throw new Error("marketing send refused: no-mailbox");
    if (await this.suppressed(to)) throw new Error("marketing send refused: suppressed");
    const info = await this.transporter.sendMail({
      from: this.config.from,
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      headers: {
        "List-Unsubscribe": `<${msg.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    const accepted = (info.accepted ?? []).map((a: string | { address: string }) => (typeof a === "string" ? a : a.address));
    if (!accepted.map(normalizeEmail).includes(to)) {
      throw new Error(`marketing send not accepted by the SMTP server: ${String(info.response ?? "no response")}`);
    }
    if (!info.messageId) throw new Error("marketing send accepted but the SMTP server gave no message id");
    return { id: info.messageId };
  }
}

export type MailTransportMode = "dry-run" | "resend" | "smtp";

export function createTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const mode = (env.MAIL_TRANSPORT?.trim() || "dry-run") as MailTransportMode;
  switch (mode) {
    case "dry-run":
      return new DryRunTransport();
    case "resend":
      return new ResendMarketingTransport();
    case "smtp":
      return new SmtpMarketingTransport(smtpConfigFromEnv(env));
    default:
      throw new Error(`Unknown MAIL_TRANSPORT: "${mode}" (expected "dry-run", "resend" or "smtp")`);
  }
}
