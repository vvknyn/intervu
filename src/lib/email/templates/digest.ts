import { ctaButton, escapeHtml, renderEmailShellHtml, renderEmailShellText } from "./base";
import { EMAIL_COLORS as C } from "./palette";
import type { DigestModel, DigestSection, DigestSectionKind } from "../digest/assemble";

/** "5 new roles" vs "5+ new roles" — the "+" is the honest signal that the
 *  upstream fetch hit its own cap, so this is a floor, not an exact count
 *  (see `RawDigestSection.mayHaveMore`'s doc comment). */
function countLabel(section: Pick<DigestSection, "totalNew" | "mayHaveMore">): string {
  const suffix = section.mayHaveMore ? "+" : "";
  const noun = section.totalNew === 1 && !section.mayHaveMore ? "new role" : "new roles";
  return `${section.totalNew}${suffix} ${noun}`;
}

/**
 * How each reason words the thing a section is about. An exhaustive
 * `Record` rather than a ternary on `kind`: a new section kind is then a
 * compile error here — the one place that has to word it — instead of
 * silently inheriting whichever branch the ternary fell through to. That is
 * how the tracked-company lane avoided shipping as "quoted like a saved
 * search".
 *
 * Saved searches are quoted because the name is a string the reader typed;
 * company names are not, because they are the company's own name. The
 * tracker says WHY an unfollowed company is here — otherwise a reader who
 * never followed Stripe gets a Stripe heading with no explanation.
 */
const SECTION_SUBJECT: Record<DigestSectionKind, (name: string) => string> = {
  "followed-company": (name) => name,
  "tracked-company": (name) => `${name} (in your tracker)`,
  "saved-search": (name) => `"${name}"`,
  default: (name) => name,
};

function sectionHeading(section: DigestSection): string {
  return `${SECTION_SUBJECT[section.kind](section.name)} — ${countLabel(section)}`;
}

export function buildDigestEmail(model: DigestModel): { subject: string; html: string; text: string } {
  const total = model.sections.reduce((sum, s) => sum + s.totalNew, 0);
  const anyFloor = model.sections.some((s) => s.mayHaveMore);
  const subject = `${total}${anyFloor ? "+" : ""} new role${total === 1 && !anyFloor ? "" : "s"} this week`;

  const textSections = model.sections.map((s) => {
    const lines = s.items.map((item) => `  - ${item.title} at ${item.company}\n    ${item.href}`);
    return `${sectionHeading(s)}\n${lines.join("\n")}\n  See all: ${s.seeAllHref}`;
  });
  const bodyText = `Here's what's new since your last digest:\n\n${textSections.join("\n\n")}`;

  // A bordered list-group per section, not a <ul>. Three reasons the bullets
  // went: a bulleted link list reads as navigation rather than as results,
  // list indentation is the single most inconsistently rendered thing in
  // email, and the title is what a reader scans — it has to be the heaviest
  // thing in the row, which a bullet actively competes with.
  const htmlSections = model.sections
    .map((s) => {
      const rows = s.items
        .map(
          (item, i) =>
            `<tr><td style="padding:13px 16px;${i > 0 ? `border-top:1px solid ${C.line};` : ""}">` +
            `<a href="${item.href}" style="font-size:15px;font-weight:600;line-height:1.4;color:${C.ink};text-decoration:none;">${escapeHtml(item.title)}</a>` +
            // Company and location on one line, separated only when there IS
            // a location — a posting with none must not render a dangling
            // separator, and an empty grey line is worse than no line.
            `<div style="margin-top:3px;font-size:13px;color:${C.muted};">${escapeHtml(item.company)}` +
            (item.location ? `<span style="color:${C.faint};"> &nbsp;&middot;&nbsp; </span>${escapeHtml(item.location)}` : "") +
            `</div>` +
            `</td></tr>`,
        )
        .join("");
      return (
        `<div style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.brand};">${escapeHtml(countLabel(s))}</div>` +
        `<div style="margin:0 0 12px;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">${escapeHtml(SECTION_SUBJECT[s.kind](s.name))}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:10px;margin:0 0 12px;">${rows}</table>` +
        `<p style="margin:0 0 28px;"><a href="${s.seeAllHref}" style="font-size:13px;font-weight:600;color:${C.brand};text-decoration:none;">See all &rarr;</a></p>`
      );
    })
    .join("");
  // No "Here's what's new since your last digest" lead-in any more: the
  // heading in the shell already says how many roles and the preheader
  // already said it is the weekly one, so the sentence was pure throat-clearing
  // occupying the most valuable line in the email.
  const bodyHtml = `${htmlSections}${ctaButton(`${model.siteUrl}/jobs`, "Browse all roles")}`;

  const shell = {
    siteUrl: model.siteUrl,
    unsubscribeUrl: model.unsubscribeUrl,
    // NOT the subject. The subject carries the count because that is what
    // earns the open; repeating it as the heading put "3 new roles this
    // week" directly above a "3 NEW ROLES" section label, which is the same
    // fact three times on one screen. The heading orients, the eyebrow
    // counts, and with several sections the two stop agreeing anyway.
    heading: "Your new roles this week",
  };
  return {
    subject,
    html: renderEmailShellHtml({
      ...shell,
      preheader: model.sections.map((s) => SECTION_SUBJECT[s.kind](s.name)).slice(0, 3).join(", "),
      bodyHtml,
    }),
    text: renderEmailShellText({ ...shell, preheader: "", bodyText }),
  };
}
