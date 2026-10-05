import { SETUP_LINK_PATH } from "@/lib/onboarding/links";
import { ctaButton, escapeHtml, renderEmailShellHtml, renderEmailShellText } from "./base";
import { EMAIL_COLORS as C } from "./palette";

export interface WelcomeEmailInput {
  /** Absolute site origin (`getSiteUrl()`) — every link below is built from
   *  it rather than hardcoded, so a domain move (intervu.cc → intervuhq.com,
   *  2026-08-08) can't leave dead links buried in an email template. */
  siteUrl: string;
  unsubscribeUrl: string;
}

/**
 * The three setup steps, in the order the setup sheet asks them
 * (lib/onboarding/state.ts SETUP_STEPS). The email goes out the moment the
 * account exists, so all three are still left: the copy says what each step
 * is for, and the one button opens setup itself.
 */
interface WelcomeStep {
  label: string;
  blurb: string;
}

const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    label: "What you're after",
    blurb: "Add your résumé, or type the roles you want. Your matches start from it.",
  },
  {
    label: "Where you can work",
    blurb: "A city or country, remote only, and anywhere you'd move. Roles you can't work from rank last.",
  },
  {
    label: "New roles by email",
    blurb: "One email a week with new roles for your search. Nothing is sent unless you turn it on.",
  },
];

/**
 * The first email a real account receives.
 *
 * Deliberately does NOT use the word "verified" about a posting. The row
 * chip that used to say it was retired on 2026-08-16 (see `rowTrustChip`,
 * lib/jobs/badges.ts) because nothing in this codebase verifies that a
 * posting is genuine — the ghost screen reports the ABSENCE of bad signals,
 * which is a different claim. An email that promises verification would
 * re-make, in the one place a person reads before they ever see the product,
 * exactly the claim the product just stopped making.
 *
 * Deliberately states no corpus size either. A live count ("2,084,512 live
 * roles") is true on the day it renders and quietly wrong forever after, and
 * an email is the one surface that cannot be re-rendered once it's sent.
 */
export function buildWelcomeEmail(input: WelcomeEmailInput): { subject: string; html: string; text: string } {
  const subject = "Welcome to velai: three steps to set up your search";
  const setupUrl = `${input.siteUrl}${SETUP_LINK_PATH}`;
  const settingsUrl = `${input.siteUrl}/settings?tab=prefs`;

  const intro =
    "Thanks for signing up. velai lists roles taken straight from employers' own careers pages, screened for the ones that aren't really open. Three short steps make it show the ones that fit you.";
  const laterLine = "Skip any step. Settings › Preferences keeps the same answers, so you can change them there any time.";
  // Points at the contact form, NOT at a reply. `intervuhq.com` publishes no
  // MX record (verified 2026-08-17, `dig MX intervuhq.com` returns nothing),
  // so the domain can send but cannot receive: a reply to this email fails at
  // the reader's own mail server. Resend is a sending service and does not
  // provide an inbox. An earlier version of this line invited a reply, which
  // would have promised a channel that does not exist to every new account.
  const contactUrl = `${input.siteUrl}/contact`;
  const outroLead = "Something broken or missing?";
  const outroText = `${outroLead} Tell us at ${contactUrl}`;

  const bodyText = [
    intro,
    // Blank line BETWEEN steps, not just around the group: joined by a single
    // newline the label and blurb of adjacent steps run together into one
    // wall in every plain-text client.
    WELCOME_STEPS.map((step, i) => `${i + 1}. ${step.label}\n${step.blurb}`).join("\n\n"),
    `Finish setup: ${setupUrl}`,
    `${laterLine}\n${settingsUrl}`,
    outroText,
  ].join("\n\n");

  // Each step is its own row with its number in the brand colour, the only
  // colour in the block, so the eye lands on the steps rather than the chrome.
  const bodyHtml = [
    `<p style="margin:0 0 24px;">${escapeHtml(intro)}</p>`,
    ...WELCOME_STEPS.map(
      (step, i) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">` +
        `<tr><td style="border-left:3px solid ${C.brand};padding:2px 0 2px 14px;">` +
        `<div style="font-size:15px;font-weight:600;color:${C.ink};"><span style="color:${C.brand};">${i + 1}.</span> ${escapeHtml(step.label)}</div>` +
        `<div style="margin-top:3px;font-size:14px;line-height:1.55;color:${C.muted};">${escapeHtml(step.blurb)}</div>` +
        `</td></tr></table>`,
    ),
    ctaButton(setupUrl, "Finish setup"),
    `<p style="margin:0 0 16px;font-size:14px;color:${C.muted};">Skip any step. ` +
      `<a href="${settingsUrl}" style="color:${C.link};text-decoration:underline;">Settings › Preferences</a> keeps the same answers, so you can change them there any time.</p>`,
    `<p style="margin:0;font-size:14px;color:${C.muted};">${outroLead} ` +
      `<a href="${contactUrl}" style="color:${C.link};text-decoration:underline;">Tell us</a>.</p>`,
  ].join("");

  // Not a restatement of the subject: the two sit next to each other in the
  // inbox list, so repeating it wastes the only other line of copy a reader
  // sees before deciding whether to open.
  const preheader = "What you're after, where you can work, and a weekly email only if you want one.";

  return {
    subject,
    html: renderEmailShellHtml({
      siteUrl: input.siteUrl,
      unsubscribeUrl: input.unsubscribeUrl,
      preheader,
      heading: "Welcome to velai",
      bodyHtml,
    }),
    text: renderEmailShellText({
      siteUrl: input.siteUrl,
      unsubscribeUrl: input.unsubscribeUrl,
      preheader: "",
      heading: "Welcome to velai",
      bodyText,
    }),
  };
}
