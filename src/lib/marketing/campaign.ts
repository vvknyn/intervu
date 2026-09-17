/**
 * Renders a one-off marketing campaign from a markdown content file
 * (`content/marketing/<name>.md`) into a subject/html/text triple for one
 * recipient.
 *
 * Deliberately reuses rather than re-implements the pieces that already
 * exist for the product's other emails: the Outlook-safe table shell +
 * wordmark (`renderEmailShellHtml`/`renderEmailShellText`,
 * `src/lib/email/templates/base.ts`) and the design-token copies
 * (`palette.ts`). The only genuinely new piece is the CAN-SPAM/CASL sender
 * identity block a one-off broadcast needs that a transactional/digest
 * email does not.
 *
 * `renderCampaign` is a pure function — no `fs`, no `process.env`, no
 * crypto — so it is directly unit-testable. `loadCampaign` is the one bit
 * of I/O (reads the content file); the unsubscribe URL and sender identity
 * are computed by the caller (the send script) and passed in, the same
 * shape `buildDigestEmail`'s callers already use.
 */
import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { escapeHtml, renderEmailShellHtml, renderEmailShellText } from "@/lib/email/templates/base";
import { EMAIL_COLORS as C, EMAIL_FONT_SANS } from "@/lib/email/templates/palette";

export interface Campaign {
  name: string;
  subject: string;
  preheader: string;
  bodyMarkdown: string;
}

export interface CampaignRecipient {
  email: string;
  firstName: string | null;
  unsubscribeUrl: string;
}

export interface CampaignSender {
  name: string | null;
  postalAddress: string | null;
}

export interface RenderedCampaign {
  subject: string;
  html: string;
  text: string;
}

const CONTENT_DIR = path.join(process.cwd(), "content", "marketing");

/** Minimal front-matter parser: a `---`-delimited block of `key: value`
 *  lines followed by the markdown body. No nested structures — the two
 *  fields a campaign needs (subject, preheader) are both single-line. */
export function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw.trim() };
  const [, frontMatter, body] = match;
  const data: Record<string, string> = {};
  for (const line of frontMatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key) data[key] = line.slice(idx + 1).trim();
  }
  return { data, body: body.trim() };
}

export function loadCampaign(name: string): Campaign {
  const file = path.join(CONTENT_DIR, `${name}.md`);
  const raw = fs.readFileSync(file, "utf8");
  const { data, body } = parseFrontMatter(raw);
  if (!data.subject || !data.preheader) {
    throw new Error(`campaign "${name}" is missing required front matter (subject, preheader)`);
  }
  return { name, subject: data.subject, preheader: data.preheader, bodyMarkdown: body };
}

/** The one substitution this campaign format supports. Anything else in
 *  `{{...}}` is left as-is on purpose — a silently-dropped unknown token
 *  would be a lying fallback (it looks personalized but isn't). */
function applyTemplate(text: string, recipient: CampaignRecipient): string {
  return text.replace(/\{\{firstName\}\}/g, recipient.firstName?.trim() || "there");
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Plain-text counterpart of the markdown → HTML pass, from the same
 *  source, so the two can't drift apart into different content. */
function markdownToText(markdown: string): string {
  const withHeadingsAndBullets = markdown
    .split("\n")
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.*)/);
      if (heading) return heading[1].toUpperCase();
      const bullet = line.match(/^[-*]\s+(.*)/);
      if (bullet) return `  - ${bullet[1]}`;
      return line;
    })
    .join("\n");

  return withHeadingsAndBullets
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function senderIdentityHtml(sender: CampaignSender): string {
  const name = sender.name?.trim() || "[sender name not configured]";
  const address = sender.postalAddress?.trim() || "[sender address not configured]";
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid ${C.line};font-family:${EMAIL_FONT_SANS};font-size:12px;line-height:1.6;color:${C.muted};">
    <p style="margin:0 0 4px;">${escapeHtml(name)}<br />${escapeHtml(address)}</p>
    <p style="margin:0;color:${C.faint};">Why you got this: you have a velai account.</p>
  </div>`;
}

function senderIdentityText(sender: CampaignSender): string {
  const name = sender.name?.trim() || "[sender name not configured]";
  const address = sender.postalAddress?.trim() || "[sender address not configured]";
  return [name, address, "", "Why you got this: you have a velai account."].join("\n");
}

export function renderCampaign(
  campaign: Campaign,
  recipient: CampaignRecipient,
  sender: CampaignSender,
  siteUrl: string,
): RenderedCampaign {
  const subject = applyTemplate(campaign.subject, recipient);
  const preheader = applyTemplate(campaign.preheader, recipient);
  const bodyMarkdown = applyTemplate(campaign.bodyMarkdown, recipient);

  const bodyHtml = md.render(bodyMarkdown) + senderIdentityHtml(sender);
  const bodyText = [markdownToText(bodyMarkdown), "", senderIdentityText(sender)].join("\n");

  const html = renderEmailShellHtml({
    siteUrl,
    unsubscribeUrl: recipient.unsubscribeUrl,
    preheader,
    heading: subject,
    bodyHtml,
  });
  const text = renderEmailShellText({
    siteUrl,
    unsubscribeUrl: recipient.unsubscribeUrl,
    preheader,
    heading: subject,
    bodyText,
  });

  return { subject, html, text };
}
