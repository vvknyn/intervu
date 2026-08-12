import { renderEmailShellHtml, renderEmailShellText } from "./base";
import type { DigestModel, DigestSection } from "../digest/assemble";

/** Job titles/companies are employer-supplied, external data — unlike the
 *  waitlist template's internal enum labels, this needs real escaping. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** "5 new roles" vs "5+ new roles" — the "+" is the honest signal that the
 *  upstream fetch hit its own cap, so this is a floor, not an exact count
 *  (see `RawDigestSection.mayHaveMore`'s doc comment). */
function countLabel(section: Pick<DigestSection, "totalNew" | "mayHaveMore">): string {
  const suffix = section.mayHaveMore ? "+" : "";
  const noun = section.totalNew === 1 && !section.mayHaveMore ? "new role" : "new roles";
  return `${section.totalNew}${suffix} ${noun}`;
}

function sectionHeading(section: DigestSection): string {
  const subject = section.kind === "followed-company" ? section.name : `"${section.name}"`;
  return `${subject} — ${countLabel(section)}`;
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

  const htmlSections = model.sections
    .map((s) => {
      const items = s.items
        .map(
          (item) =>
            `<li style="margin-bottom:8px;"><a href="${item.href}" style="color:#111;text-decoration:underline;">${escapeHtml(item.title)}</a> at ${escapeHtml(item.company)}</li>`,
        )
        .join("");
      return `<h2 style="font-size:15px;margin:24px 0 8px;">${escapeHtml(sectionHeading(s))}</h2><ul style="padding-left:20px;margin:0 0 8px;">${items}</ul><a href="${s.seeAllHref}" style="font-size:13px;color:#555;">See all &rarr;</a>`;
    })
    .join("");
  const bodyHtml = `<p>Here's what's new since your last digest:</p>${htmlSections}`;

  return {
    subject,
    html: renderEmailShellHtml(bodyHtml, model.unsubscribeUrl),
    text: renderEmailShellText(bodyText, model.unsubscribeUrl),
  };
}
