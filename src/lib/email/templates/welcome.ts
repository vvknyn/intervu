import { ctaButton, renderEmailShellHtml, renderEmailShellText } from "./base";
import { EMAIL_COLORS as C } from "./palette";

export interface WelcomeEmailInput {
  /** Absolute site origin (`getSiteUrl()`) — every link below is built from
   *  it rather than hardcoded, so a domain move (intervu.cc → intervuhq.com,
   *  2026-08-08) can't leave dead links buried in an email template. */
  siteUrl: string;
  unsubscribeUrl: string;
}

/**
 * One feature, one line, in the order a new account actually meets them:
 * search first, then the two things that bring someone BACK (a saved search
 * and the tracker), then the two that only matter once they're invested.
 */
interface WelcomeFeature {
  href: string;
  label: string;
  blurb: string;
}

function welcomeFeatures(siteUrl: string): WelcomeFeature[] {
  return [
    {
      href: `${siteUrl}/jobs`,
      label: "Search roles",
      blurb:
        "Every posting is scraped from the employer's own careers page — never a job board, never an agency reposting someone else's listing.",
    },
    {
      href: `${siteUrl}/jobs`,
      label: "Save a search",
      blurb:
        "Set your filters once, save them, and get an email when new roles match. It's the difference between checking a job board and having it check for you.",
    },
    {
      href: `${siteUrl}/yours`,
      label: "Track what you're going after",
      blurb:
        "Save a role and it lands in your tracker, from interested through to offer — with the posting's own history attached.",
    },
    {
      href: `${siteUrl}/jobs`,
      label: "See the posting checks",
      blurb:
        "Every posting is screened for signs it isn't really open — reposts, stale dates, thin descriptions. Each role shows what we checked and what we couldn't.",
    },
    {
      href: `${siteUrl}/connect`,
      label: "Search from inside your AI",
      blurb:
        "Connect Claude, ChatGPT, or Cursor and search your roles without switching tabs.",
    },
  ];
}

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
  const features = welcomeFeatures(input.siteUrl);
  const subject = "Welcome to intervu — here's what it does";

  const intro =
    "Thanks for signing up. intervu is a job search built on postings taken straight from employers, screened for the ones that aren't really open.";
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
    // Blank line BETWEEN feature blocks, not just around the group: joined
    // by a single newline the label, blurb and link of adjacent features run
    // together into one wall in every plain-text client.
    features.map((f) => `${f.label}\n${f.blurb}\n${f.href}`).join("\n\n"),
    outroText,
  ].join("\n\n");

  // Each feature is its own bordered row rather than a paragraph: five
  // stacked <p>s read as one grey wall, and the label is the thing a reader
  // scans for. The left rule in the brand colour is the only colour in the
  // block, so the eye lands on the list rather than on the chrome.
  const bodyHtml = [
    `<p style="margin:0 0 24px;">${intro}</p>`,
    ...features.map(
      (f) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">` +
        `<tr><td style="border-left:3px solid ${C.brand};padding:2px 0 2px 14px;">` +
        `<a href="${f.href}" style="font-size:15px;font-weight:600;color:${C.ink};text-decoration:none;">${f.label} &rarr;</a>` +
        `<div style="margin-top:3px;font-size:14px;line-height:1.55;color:${C.muted};">${f.blurb}</div>` +
        `</td></tr></table>`,
    ),
    ctaButton(`${input.siteUrl}/jobs`, "Start searching"),
    `<p style="margin:0;font-size:14px;color:${C.muted};">${outroLead} ` +
      `<a href="${contactUrl}" style="color:${C.brand};text-decoration:underline;">Tell us</a>.</p>`,
  ].join("");

  return {
    subject,
    html: renderEmailShellHtml({
      siteUrl: input.siteUrl,
      unsubscribeUrl: input.unsubscribeUrl,
      // Not a restatement of the subject: the two sit next to each other in
      // the inbox list, so repeating it wastes the only other line of copy a
      // reader sees before deciding whether to open.
      preheader: "Postings straight from employers, screened for the ones that aren't really open.",
      heading: "Welcome to intervu",
      bodyHtml,
    }),
    text: renderEmailShellText({
      siteUrl: input.siteUrl,
      unsubscribeUrl: input.unsubscribeUrl,
      preheader: "",
      heading: "Welcome to intervu",
      bodyText,
    }),
  };
}
