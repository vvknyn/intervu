import { renderEmailShellHtml, renderEmailShellText } from "./base";
import { EMAIL_COLORS as C } from "./palette";

export interface WaitlistConfirmEmailInput {
  /** Plain-language description of what was signed up for, e.g. "the Hunt
   *  credit pack" or "OpenClaw on Windows" — always built from an internal,
   *  enum-validated label (PACKS / CONNECT_CLIENTS), never raw user input,
   *  so no HTML-escaping is needed here. */
  whatSignedUpFor: string;
  unsubscribeUrl: string;
  /** Absolute site origin — the shell builds the brand header and footer
   *  links from it. */
  siteUrl: string;
}

/**
 * The domain-warming send (E3): first real email intervu sends. Honest
 * about timing on purpose — "no date yet" beats inventing one that later
 * has to be walked back.
 */
export function buildWaitlistConfirmEmail(
  input: WaitlistConfirmEmailInput,
): { subject: string; html: string; text: string } {
  const subject = `You're on the list — ${input.whatSignedUpFor}`;
  const heading = "You're on the list";
  const bodyText = `You're on the waitlist for ${input.whatSignedUpFor}.\n\nWe don't have a launch date yet — we'll email this address the moment it's ready. Nothing else in the meantime.`;
  const bodyHtml =
    `<p style="margin:0 0 16px;">You're on the waitlist for <strong style="color:${C.ink};">${input.whatSignedUpFor}</strong>.</p>` +
    `<p style="margin:0;">We don't have a launch date yet &mdash; we'll email this address the moment it's ready. Nothing else in the meantime.</p>`;

  const shell = { siteUrl: input.siteUrl, unsubscribeUrl: input.unsubscribeUrl, heading };
  return {
    subject,
    html: renderEmailShellHtml({
      ...shell,
      preheader: "No launch date yet. We'll email this address the moment it's ready.",
      bodyHtml,
    }),
    text: renderEmailShellText({ ...shell, preheader: "", bodyText }),
  };
}
