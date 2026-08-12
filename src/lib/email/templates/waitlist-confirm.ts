import { renderEmailShellHtml, renderEmailShellText } from "./base";

export interface WaitlistConfirmEmailInput {
  /** Plain-language description of what was signed up for, e.g. "the Hunt
   *  credit pack" or "OpenClaw on Windows" — always built from an internal,
   *  enum-validated label (PACKS / CONNECT_CLIENTS), never raw user input,
   *  so no HTML-escaping is needed here. */
  whatSignedUpFor: string;
  unsubscribeUrl: string;
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
  const bodyText = `You're on the waitlist for ${input.whatSignedUpFor}.\n\nWe don't have a launch date yet — we'll email this address the moment it's ready. Nothing else in the meantime.`;
  const bodyHtml = `<p>You're on the waitlist for <strong>${input.whatSignedUpFor}</strong>.</p><p>We don't have a launch date yet — we'll email this address the moment it's ready. Nothing else in the meantime.</p>`;

  return {
    subject,
    html: renderEmailShellHtml(bodyHtml, input.unsubscribeUrl),
    text: renderEmailShellText(bodyText, input.unsubscribeUrl),
  };
}
