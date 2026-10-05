/**
 * Renders a one-off marketing campaign from a markdown content file
 * (`content/marketing/<name>.md`) into a subject/html/text triple for one
 * recipient.
 *
 * Deliberately reuses rather than re-implements the pieces that already
 * exist for the product's other emails: the Outlook-safe table shell +
 * wordmark (`renderEmailShellHtml`/`renderEmailShellText`,
 * `src/lib/email/templates/base.ts`) and the design-token copies
 * (`palette.ts`). The only genuinely new piece is the footer a one-off
 * broadcast carries: the sender's name and address when configured, and
 * why the person got it.
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
import type Token from "markdown-it/lib/token.mjs";
import { ctaButton, escapeHtml, renderEmailShellHtml, renderEmailShellText } from "@/lib/email/templates/base";
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

/** The shell's card is 600px with 32px either side, so a picture is at most this wide. */
export const CAMPAIGN_IMAGE_WIDTH = 536;

/** The link title that turns a paragraph holding only that link into the brand button: `[Label](/path "button")`. */
const BUTTON_TITLE = "button";

/** A site path (`/blog/...`) resolved against the site; a full URL as written. */
export function absoluteUrl(href: string, siteUrl: string): string {
  return href.startsWith("/") ? `${siteUrl.replace(/\/$/, "")}${href}` : href;
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

interface RenderEnv {
  siteUrl: string;
}

// Mail clients ignore <head> styles, so each element carries its own: the
// shell's 15px body type with even paragraph spacing, links in the brand
// colour, and pictures that shrink to fit a phone.
md.renderer.rules.paragraph_open = (tokens, idx) => (tokens[idx].hidden ? "" : `<p style="margin:0 0 16px;">`);
md.renderer.rules.link_open = (tokens, idx, _options, env: RenderEnv) => {
  const href = absoluteUrl(tokens[idx].attrGet("href") ?? "", env.siteUrl);
  return `<a href="${escapeHtml(href)}" style="color:${C.link};text-decoration:underline;">`;
};
md.renderer.rules.image = (tokens, idx, _options, env: RenderEnv) => {
  const token = tokens[idx];
  const src = absoluteUrl(token.attrGet("src") ?? "", env.siteUrl);
  const alt = token.children?.map((t) => t.content).join("") ?? token.content;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${CAMPAIGN_IMAGE_WIDTH}" style="display:block;width:100%;max-width:${CAMPAIGN_IMAGE_WIDTH}px;height:auto;border:0;border-radius:10px;" />`;
};

/** A paragraph that is one link titled "button" becomes `ctaButton`, the same pill every Velai email uses. */
md.core.ruler.push("campaign_button", (state) => {
  const out: Token[] = [];
  const t = state.tokens;
  for (let i = 0; i < t.length; i++) {
    const inline = t[i + 1];
    const kids = inline?.children ?? [];
    const isButton =
      t[i].type === "paragraph_open" &&
      inline?.type === "inline" &&
      t[i + 2]?.type === "paragraph_close" &&
      kids.length === 3 &&
      kids[0].type === "link_open" &&
      kids[0].attrGet("title") === BUTTON_TITLE &&
      kids[1].type === "text" &&
      kids[2].type === "link_close";
    if (!isButton) {
      out.push(t[i]);
      continue;
    }
    const block = new state.Token("html_block", "", 0);
    const env = state.env as RenderEnv;
    block.content = ctaButton(escapeHtml(absoluteUrl(kids[0].attrGet("href") ?? "", env.siteUrl)), escapeHtml(kids[1].content));
    out.push(block);
    i += 2;
  }
  state.tokens = out;
});

/** Plain-text counterpart of the markdown → HTML pass, from the same
 *  source, so the two can't drift apart into different content. */
function markdownToText(markdown: string, siteUrl: string): string {
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
    // Pictures say nothing a plain-text reader needs; the words around them carry it.
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "")
    // A trailing backslash is markdown's line break; plain text breaks the line already.
    .replace(/\\$/gm, "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => `${label} (${absoluteUrl(href, siteUrl)})`)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The sender's name and postal address, each only when set: Vivek chose to
 *  send without them (2026-10-05), so an unset one is left out, never shown
 *  as a placeholder. The reason line always shows. */
function senderLines(sender: CampaignSender): string[] {
  return [sender.name?.trim(), sender.postalAddress?.trim()].filter((line): line is string => Boolean(line));
}

const WHY_YOU_GOT_THIS = "Why you got this: you have a Velai account.";

function senderIdentityHtml(sender: CampaignSender): string {
  const lines = senderLines(sender);
  const identity = lines.length ? `<p style="margin:0 0 4px;">${lines.map(escapeHtml).join("<br />")}</p>\n    ` : "";
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid ${C.line};font-family:${EMAIL_FONT_SANS};font-size:12px;line-height:1.6;color:${C.muted};">
    ${identity}<p style="margin:0;color:${C.faint};">${WHY_YOU_GOT_THIS}</p>
  </div>`;
}

function senderIdentityText(sender: CampaignSender): string {
  const lines = senderLines(sender);
  return [...lines, ...(lines.length ? [""] : []), WHY_YOU_GOT_THIS].join("\n");
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

  const env: RenderEnv = { siteUrl };
  const bodyHtml = md.render(bodyMarkdown, env) + senderIdentityHtml(sender);
  const bodyText = [markdownToText(bodyMarkdown, siteUrl), "", senderIdentityText(sender)].join("\n");

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
