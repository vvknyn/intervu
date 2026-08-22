/**
 * The one-click confirmation email for "watch this company" (verified email
 * follow, docs/specs/2026-08-19-verified-email-follow-design.md). It
 * confirms a single action the visitor just took on our own form, so unlike
 * digest/welcome/waitlist_confirm it carries no unsubscribe footer — see
 * `EMAIL_KIND_POLICY["verify_follow"]` (types.ts), which marks it
 * non-suppressible for the same reason `transactional` is.
 *
 * Deliberately does not use `renderEmailShellHtml` (templates/base.ts): that
 * shell's footer requires an `unsubscribeUrl`, which this kind never has.
 */
import { ctaButton, escapeHtml } from "./templates/base";
import { EMAIL_COLORS as C } from "./templates/palette";
import { sendEmail } from "./send";

export function verifyFollowEmailContent(input: {
  companyName: string;
  verifyUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Confirm: watch ${input.companyName} for new roles`;
  const promiseLine = `One click and we'll email you when ${input.companyName} posts or closes roles. Nothing else.`;
  const ignoreLine = "If you didn't ask for this, ignore this email.";

  const text = [promiseLine, input.verifyUrl, ignoreLine].join("\n\n");
  const html =
    `<p style="margin:0 0 16px;">${escapeHtml(promiseLine)}</p>` +
    ctaButton(input.verifyUrl, "Confirm and watch") +
    `<p style="margin:0;font-size:13px;color:${C.muted};">${escapeHtml(ignoreLine)}</p>`;

  return { subject, text, html };
}

/** Thin send wrapper — the one place that knows this kind is "verify_follow". */
export async function sendVerifyFollowEmail(input: {
  email: string;
  companyName: string;
  verifyUrl: string;
}): Promise<void> {
  const { subject, text, html } = verifyFollowEmailContent(input);
  await sendEmail({ to: input.email, subject, text, html, kind: "verify_follow" });
}
