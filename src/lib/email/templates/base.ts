import { EMAIL_COLORS as C, EMAIL_FONT_SANS, EMAIL_WORDMARK } from "./palette";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

/**
 * The one HTML/text shell every non-transactional template wraps its body
 * in — brand header, hero heading, and unsubscribe footer live here ONCE
 * rather than being pasted into each template file, so they can never drift
 * between the welcome email, the digest and the waitlist confirmation (or a
 * future kind). A template supplies only what is genuinely its own: the
 * preheader, the heading, and the body.
 *
 * WHY TABLES. Outlook on Windows renders through Word, which has no reliable
 * `max-width` on a `<div>`, so a div-only shell renders full-bleed there. A
 * `role="presentation"` table with a fixed-width inner cell is the layout
 * every mail client has agreed on for twenty years. Same reason there is no
 * flexbox, no grid, no `<style>` block and no class attribute below: Gmail
 * strips `<head>` styles on forwarded mail, so every rule is inline.
 *
 * COLOURS AND TYPE come from `./palette`, which is the single copy of the
 * product's tokens and is drift-tested against `globals.css`. Nothing in
 * this file may write a hex literal.
 */

/** Escapes employer/user-supplied text before it lands in HTML — anything
 *  that isn't an internal, enum-validated label needs this (see
 *  waitlist-confirm.ts's comment on the one exception). Shared here so a
 *  second template needing it consolidates onto one copy instead of pasting
 *  its own. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Site origin. Passed in rather than read from `getSiteUrl()` because that
 *  helper throws when `NEXT_PUBLIC_SITE_URL` is unset, which would make
 *  every template untestable without env. */
export interface EmailShellInput {
  siteUrl: string;
  unsubscribeUrl: string;
  /**
   * The grey line clients show next to the subject in the inbox list. Worth
   * its own field: with no preheader, Gmail pulls the first text it finds,
   * which for the digest was "Here's what's new since your last digest:" —
   * the one sentence in the email carrying no information.
   */
  preheader: string;
  /** Display heading at the top of the card. */
  heading: string;
  bodyHtml: string;
}

const CARD_WIDTH = 600;

/** Every text run in the shell carries the stack inline — see WHY TABLES. */
const FONT = `font-family:${EMAIL_FONT_SANS};`;

/**
 * Hidden preview text. The zero-width-joiner run after it is the standard
 * trick to stop the client filling the remaining preview space with the
 * body's opening words: without padding, Gmail appends "intervu Search
 * roles Save a search..." straight onto the end of the preheader.
 */
function preheaderBlock(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${text}` +
    `${"&#8203;&nbsp;".repeat(60)}</div>`
  );
}

/**
 * Charcoal header band: hosted mark + title-case Velai lockup (Concept A).
 * Mark is `public/velai-logo.png` — same raster as in-app chrome; SVG is
 * unreliable in Gmail/Outlook. Empty `alt` so screen readers do not hear the
 * brand twice beside the text wordmark.
 */
function headerBand(siteUrl: string): string {
  const { text, fontSize, fontWeight, letterSpacing } = EMAIL_WORDMARK;
  return `<tr>
        <td align="center" bgcolor="${C.band}" style="padding:28px 32px 24px;background-color:${C.band};">
          <a href="${siteUrl}" style="text-decoration:none;color:${C.bandInk};">
            <img src="${siteUrl}/velai-logo.png" width="28" height="28" alt="" style="border-radius:6px;vertical-align:middle;border:0;display:inline-block;" />
            <span style="${FONT}font-size:${fontSize}px;font-weight:${fontWeight};letter-spacing:${letterSpacing};color:${C.bandInk};vertical-align:middle;padding-left:8px;">${text}</span>
          </a>
        </td>
      </tr>`;
}

/** Minimal band for transactional mail (no site link when origin unknown). */
function transactionalHeaderBand(siteUrl?: string): string {
  const { text, fontSize, fontWeight, letterSpacing } = EMAIL_WORDMARK;
  const mark = siteUrl
    ? `<img src="${siteUrl}/velai-logo.png" width="28" height="28" alt="" style="border-radius:6px;vertical-align:middle;border:0;display:inline-block;" />`
    : "";
  const inner =
    mark +
    `<span style="${FONT}font-size:${fontSize}px;font-weight:${fontWeight};letter-spacing:${letterSpacing};color:${C.bandInk};vertical-align:middle;${mark ? "padding-left:8px;" : ""}">${text}</span>`;
  const wrapped = siteUrl
    ? `<a href="${siteUrl}" style="text-decoration:none;color:${C.bandInk};">${inner}</a>`
    : inner;
  return `<tr>
        <td align="center" bgcolor="${C.band}" style="padding:28px 32px 20px;background-color:${C.band};">${wrapped}</td>
      </tr>`;
}

/**
 * Footer. Carries no physical postal address on purpose — inventing one
 * would be worse than omitting it. CAN-SPAM requires a real mailing address
 * on commercial email, and that is a fact only Vivek can supply.
 *
 * The contact link, not a reply invitation: `intervuhq.com` publishes no MX
 * record, so mail sent back to the from-address fails at the sender's own
 * server. Guarded by `tests/unit/email-no-reply-channel.test.ts`.
 */
function footer(siteUrl: string, unsubscribeUrl: string): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:${C.muted};text-decoration:none;">${label}</a>`;
  const separator = `<span style="color:${C.faint};"> &nbsp;&middot;&nbsp; </span>`;
  return `<tr>
        <td bgcolor="${C.card}" style="padding:0 32px 32px;background-color:${C.card};">
          <div style="border-top:1px solid ${C.line};padding-top:20px;${FONT}font-size:12px;line-height:1.6;color:${C.muted};">
            <p style="margin:0 0 10px;">Job postings taken straight from employers &mdash; never a job board, never an agency repost.</p>
            <p style="margin:0 0 10px;">
              ${link(`${siteUrl}/jobs`, "Search roles")}
              ${separator}
              ${link(`${siteUrl}/yours`, "Your tracker")}
              ${separator}
              ${link(`${siteUrl}/contact`, "Contact")}
            </p>
            <p style="margin:0 0 10px;">
              Questions: ${link(`mailto:${PUBLIC_SUPPORT_EMAIL}`, PUBLIC_SUPPORT_EMAIL)}
            </p>
            <p style="margin:0;color:${C.faint};">
              <a href="${unsubscribeUrl}" style="color:${C.faint};text-decoration:underline;">Unsubscribe</a> &mdash; takes effect immediately.
            </p>
          </div>
        </td>
      </tr>`;
}

/**
 * A call-to-action button, shared so the digest and the welcome email cannot
 * end up with two different brand colours.
 *
 * A table with a background colour rather than a styled `<a>`: Outlook
 * ignores `padding` on an anchor, which collapses a padded link into bare
 * underlined text. The radius is simply dropped there — a square button is a
 * fine degradation, an unstyled link is not.
 */
export function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
        <tr>
          <td bgcolor="${C.brand}" style="border-radius:9999px;background-color:${C.brand};">
            <a href="${href}" style="display:inline-block;padding:12px 24px;${FONT}font-size:15px;font-weight:600;color:${C.onBrand};text-decoration:none;border-radius:9999px;">${label}</a>
          </td>
        </tr>
      </table>`;
}

function shellOpen(preheader: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Opts out of the automatic dark-mode inversion Apple Mail and Outlook
         apply to light emails, which turns ink on paper into a muddy
         grey-on-charcoal this design never gets to check. -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};-webkit-font-smoothing:antialiased;">
    ${preheaderBlock(preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${CARD_WIDTH}px;border:1px solid ${C.line};border-radius:14px;overflow:hidden;">`;
}

function shellClose(): string {
  return `          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEmailShellHtml(input: EmailShellInput): string {
  return (
    shellOpen(input.preheader).replace(
      /<\/head>/,
      `<title>${escapeHtml(input.heading)}</title>\n  </head>`,
    ) +
    headerBand(input.siteUrl) +
    `<tr>
              <td bgcolor="${C.card}" style="padding:28px 32px 8px;background-color:${C.card};">
                <h1 style="margin:0;${FONT}font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(input.heading)}</h1>
              </td>
            </tr>
            <tr>
              <td bgcolor="${C.card}" style="padding:16px 32px 8px;background-color:${C.card};${FONT}font-size:15px;line-height:1.6;color:${C.ink};">
                ${input.bodyHtml}
              </td>
            </tr>
            ${footer(input.siteUrl, input.unsubscribeUrl)}` +
    shellClose()
  );
}

/** Transactional / verify kinds: same Concept A band + paper card, no unsubscribe footer. */
export function renderTransactionalEmailHtml(input: {
  bodyHtml: string;
  preheader?: string;
  siteUrl?: string;
}): string {
  const preheader = input.preheader ?? "";
  return (
    shellOpen(preheader) +
    transactionalHeaderBand(input.siteUrl) +
    `<tr>
              <td bgcolor="${C.card}" style="padding:28px 32px 32px;background-color:${C.card};${FONT}font-size:15px;line-height:1.6;color:${C.ink};">
                ${input.bodyHtml}
              </td>
            </tr>` +
    shellClose()
  );
}

export function renderEmailShellText(input: Omit<EmailShellInput, "bodyHtml"> & { bodyText: string }): string {
  return [
    EMAIL_WORDMARK.text,
    "",
    input.heading,
    "",
    input.bodyText,
    "",
    "---",
    "Job postings taken straight from employers — never a job board, never an agency repost.",
    `Search roles: ${input.siteUrl}/jobs`,
    `Your tracker: ${input.siteUrl}/yours`,
    `Contact: ${input.siteUrl}/contact`,
    `Email: ${PUBLIC_SUPPORT_EMAIL}`,
    "",
    `Unsubscribe (takes effect immediately): ${input.unsubscribeUrl}`,
  ].join("\n");
}
