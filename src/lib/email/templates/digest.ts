import { renderEmailShellHtml, renderEmailShellText } from "./base";
import type { DigestModel, DigestSection, DigestSectionKind } from "../digest/assemble";

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
