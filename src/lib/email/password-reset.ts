/**
 * The password-reset email — WorkOS mints the token (`createPasswordReset`),
 * this builds the link back onto OUR domain and sends it.
 *
 * Modelled on `verify-account-email.ts`, including its reason for not using
 * `renderEmailShellHtml`: that shell's footer requires an `unsubscribeUrl`,
 * which a `password_reset` send never has (see EMAIL_KIND_POLICY, types.ts) —
 * this is a transactional, self-requested action, not a marketing send.
 *
 * The link points at `/reset-password?token=…` on our own site rather than
 * WorkOS's own `passwordResetUrl` (a WorkOS-hosted page) — `ResetPasswordForm`
 * already owns this app's reset UI, and `resetPassword({token, newPassword})`
 * only needs the bare token, not WorkOS's hosted page.
 */
import { ctaButton, escapeHtml } from "./templates/base";
import { EMAIL_COLORS as C } from "./templates/palette";
import { sendEmail, type SendEmailResult } from "./send";

export function passwordResetEmailContent(input: { resetUrl: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const subject = "Reset your intervu password";
    const promiseLine = "Someone asked to reset the password on this account. Click below to choose a new one.";
    const expiryLine = "This link expires soon and can only be used once.";
    const ignoreLine = "If you didn't ask for this, ignore this email and your password stays the same.";

    const text = [promiseLine, input.resetUrl, expiryLine, ignoreLine].join("\n\n");
    const html =
        `<p style="margin:0 0 16px;">${escapeHtml(promiseLine)}</p>` +
        ctaButton(input.resetUrl, "Choose a new password") +
        `<p style="margin:0 0 8px;font-size:13px;color:${C.muted};">${escapeHtml(expiryLine)}</p>` +
        `<p style="margin:0;font-size:13px;color:${C.muted};">${escapeHtml(ignoreLine)}</p>`;

    return { subject, text, html };
}

/** Thin send wrapper — the one place that knows this kind is "password_reset". */
export async function sendPasswordResetEmail(input: {
    email: string;
    resetUrl: string;
}): Promise<SendEmailResult> {
    const { subject, text, html } = passwordResetEmailContent({ resetUrl: input.resetUrl });
    return sendEmail({ to: input.email, subject, text, html, kind: "password_reset" });
}
