/**
 * The one-click confirmation email for "attach this address to my account so
 * you can send me job alerts".
 *
 * Modelled on `verify-follow.ts`, including its reason for NOT using
 * `renderEmailShellHtml`: that shell's footer requires an `unsubscribeUrl`,
 * which a `verify_email` send never has (see EMAIL_KIND_POLICY, types.ts).
 *
 * The copy states the whole deal in one line, because this address is being
 * collected from someone who already has an account and may not remember
 * asking: what we'll send, and that ignoring it costs them nothing.
 */
import { ctaButton, escapeHtml } from "./templates/base";
import { EMAIL_COLORS as C } from "./templates/palette";
import { sendEmail } from "./send";

export function verifyAccountEmailContent(input: { verifyUrl: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const subject = "Confirm your email to get job alerts";
    const promiseLine =
        "One click and we'll start sending your job alerts here — new roles matching your searches and the companies you follow. You can turn them off any time.";
    const ignoreLine = "If you didn't ask for this, ignore this email and nothing changes.";

    const text = [promiseLine, input.verifyUrl, ignoreLine].join("\n\n");
    const html =
        `<p style="margin:0 0 16px;">${escapeHtml(promiseLine)}</p>` +
        ctaButton(input.verifyUrl, "Confirm my email") +
        `<p style="margin:0;font-size:13px;color:${C.muted};">${escapeHtml(ignoreLine)}</p>`;

    return { subject, text, html };
}

/** Thin send wrapper — the one place that knows this kind is "verify_email". */
export async function sendVerifyAccountEmail(input: {
    email: string;
    verifyUrl: string;
}): Promise<void> {
    const { subject, text, html } = verifyAccountEmailContent({ verifyUrl: input.verifyUrl });
    await sendEmail({ to: input.email, subject, text, html, kind: "verify_email" });
}
