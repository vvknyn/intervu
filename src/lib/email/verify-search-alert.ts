/**
 * One-click confirmation for anonymous weekly search alerts — same shape as
 * verify-follow.ts: confirms a single action on our form, no unsubscribe
 * footer (`EMAIL_KIND_POLICY["verify_search_alert"]`, types.ts).
 */
import { ctaButton, escapeHtml, renderTransactionalEmailHtml } from "./templates/base";
import { EMAIL_COLORS as C } from "./templates/palette";
import { sendEmail } from "./send";

export function verifySearchAlertEmailContent(input: {
  searchName: string;
  verifyUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = "Confirm: get weekly alerts for this search";
  const promiseLine = `One click and we'll email you new jobs matching "${input.searchName}" each week. Nothing else.`;
  const ignoreLine = "If you didn't ask for this, ignore this email.";

  const text = [promiseLine, input.verifyUrl, ignoreLine].join("\n\n");
  const bodyHtml =
    `<p style="margin:0 0 16px;">${escapeHtml(promiseLine)}</p>` +
    ctaButton(input.verifyUrl, "Confirm weekly alerts") +
    `<p style="margin:0;font-size:13px;color:${C.muted};">${escapeHtml(ignoreLine)}</p>`;
  const siteUrl = (() => {
    try {
      return new URL(input.verifyUrl).origin;
    } catch {
      return undefined;
    }
  })();
  const html = renderTransactionalEmailHtml({ bodyHtml, siteUrl });

  return { subject, text, html };
}

export async function sendVerifySearchAlertEmail(input: {
  email: string;
  searchName: string;
  verifyUrl: string;
}): Promise<void> {
  const { subject, text, html } = verifySearchAlertEmailContent(input);
  await sendEmail({ to: input.email, subject, text, html, kind: "verify_search_alert" });
}
