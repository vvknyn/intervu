import { ctaButton, escapeHtml, renderEmailShellHtml, renderEmailShellText } from "./base";
import { writtenInParts } from "@/lib/jobs/for-you/left-out-copy";
import { languageListText } from "@/lib/match/posting-language";
import { EMAIL_COLORS as C } from "./palette";

/** One role in the email, already worded: the fit word and its reason come from the score (`matchLabel`, `explainMatch`). */
export interface DailyPickItem {
  title: string;
  /** The employer's name as the site shows it (`presentJob`). */
  employer: string;
  /** `null` when the posting names no place we can show. */
  location: string | null;
  salary: string | null;
  /** "Strong" or "Good": a pick is never a Stretch. */
  fit: string;
  /** Why it fits, in the words the site's fit chip uses on hover. */
  why: string;
  href: string;
  /** The employer's other picks (`todaySlots`), listed under this one: each a role of its own, with its fit word and link. */
  more?: DailyPickMore[];
  /** Roles of this employer the email does not name (past the slot's cap), with the employer's page that lists them. */
  hidden?: { count: number; href: string };
}

/** An employer's other pick, under the one that leads its slot. */
export interface DailyPickMore {
  title: string;
  location: string | null;
  fit: string;
  href: string;
}

export interface DailyPicksEmailModel {
  siteUrl: string;
  unsubscribeUrl: string;
  picks: DailyPickItem[];
  /** The languages the picks are written in (`CandidateSignals.languages`); absent when none is judged. */
  languages?: readonly string[];
  /** This week's roles left out for the language they are written in ("french" → 3), said beside the picks. */
  languagesLeftOut?: Readonly<Record<string, number>>;
}

/** The rule every pick passed, said once (Today's `PICKS_BASIS`, plus where the reasons come from). */
export const DAILY_PICKS_BASIS =
  "Posted this week, in your line of work, at your level, where you can work. The same rules as Today on Velai: no AI, and nothing above your level.";

/** "Roles written in English or French. Left out this week: 3 written in German.", or null when no language is judged. */
function languagesLine(languages: readonly string[] | undefined, leftOut: Readonly<Record<string, number>> | undefined): string | null {
  const read = languageListText(languages ?? [], "or");
  if (!read) return null;
  const out = writtenInParts(leftOut ?? {});
  return out.length > 0 ? `Roles written in ${read}. Left out this week: ${out.join(", ")}.` : `Roles written in ${read}; others are left out.`;
}

/** Roles the email names: each pick and the roles listed under it. */
const rolesNamed = (picks: readonly DailyPickItem[]): number => picks.reduce((sum, pick) => sum + 1 + (pick.more?.length ?? 0), 0);

function subjectFor(count: number): string {
  return count === 1 ? "1 new role fits your résumé" : `${count} new roles fit your résumé`;
}

function metaParts(item: DailyPickItem): string[] {
  return [`${item.fit} match`, item.employer, ...(item.location ? [item.location] : []), ...(item.salary ? [item.salary] : [])];
}

/** "More at Acme": the employer's other picks under the one that leads its slot, each its own link, and the count of any the email does not name. */
function moreHtml(item: DailyPickItem): string {
  if (!item.more?.length && !item.hidden) return "";
  const others = (item.more ?? [])
    .map(
      (other) =>
        `<div style="margin-top:3px;font-size:13px;line-height:1.5;color:${C.muted};">` +
        `<a href="${other.href}" style="color:${C.ink};text-decoration:none;">${escapeHtml(other.title)}</a>` +
        ` &nbsp;&middot;&nbsp; ${escapeHtml(`${other.fit} match${other.location ? ` · ${other.location}` : ""}`)}</div>`,
    )
    .join("");
  const rest = item.hidden
    ? `<div style="margin-top:3px;font-size:13px;color:${C.muted};"><a href="${item.hidden.href}" style="color:${C.link};text-decoration:none;">See the other ${item.hidden.count} at ${escapeHtml(item.employer)}</a></div>`
    : "";
  return `<div style="margin-top:10px;padding-top:8px;border-top:1px solid ${C.line};"><div style="font-size:12px;font-weight:600;color:${C.muted};">More at ${escapeHtml(item.employer)}</div>${others}${rest}</div>`;
}

function moreText(item: DailyPickItem): string[] {
  if (!item.more?.length && !item.hidden) return [];
  return [
    `  More at ${item.employer}:`,
    ...(item.more ?? []).map((other) => `  - ${other.title} · ${other.fit} match${other.location ? ` · ${other.location}` : ""}\n    ${other.href}`),
    ...(item.hidden ? [`  See the other ${item.hidden.count} at ${item.employer}: ${item.hidden.href}`] : []),
  ];
}

export function buildDailyPicksEmail(model: DailyPicksEmailModel): { subject: string; html: string; text: string } {
  const named = rolesNamed(model.picks);
  const subject = subjectFor(named);
  const settingsUrl = `${model.siteUrl}/settings?tab=account`;
  const languagesUrl = `${model.siteUrl}/settings?tab=prefs`;
  const languages = languagesLine(model.languages, model.languagesLeftOut);
  const first = model.picks[0];
  const preheader = first
    ? `${first.title} at ${first.employer}${named > 1 ? ` and ${named - 1} more` : ""}`
    : "";

  const rows = model.picks
    .map(
      (item, i) =>
        `<tr><td style="padding:14px 16px;${i > 0 ? `border-top:1px solid ${C.line};` : ""}">` +
        `<a href="${item.href}" style="font-size:15px;font-weight:600;line-height:1.4;color:${C.ink};text-decoration:none;">${escapeHtml(item.title)}</a>` +
        `<div style="margin-top:3px;font-size:13px;color:${C.muted};">` +
        metaParts(item)
          .map((part, j) => (j === 0 ? `<span style="font-weight:600;color:${C.ink};">${escapeHtml(part)}</span>` : escapeHtml(part)))
          .join(`<span style="color:${C.faint};"> &nbsp;&middot;&nbsp; </span>`) +
        `</div>` +
        `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(item.why)}</div>` +
        moreHtml(item) +
        `</td></tr>`,
    )
    .join("");

  const bodyHtml =
    `<p style="margin:0 0 ${languages ? 6 : 16}px;font-size:14px;color:${C.muted};">${escapeHtml(DAILY_PICKS_BASIS)}</p>` +
    (languages
      ? `<p style="margin:0 0 16px;font-size:14px;color:${C.muted};">${escapeHtml(languages)} ` +
        `<a href="${languagesUrl}" style="color:${C.link};text-decoration:none;">Change the languages</a>.</p>`
      : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:10px;margin:0 0 20px;">${rows}</table>` +
    ctaButton(`${model.siteUrl}/jobs`, "Open Today on Velai") +
    `<p style="margin:0 0 8px;font-size:13px;color:${C.muted};">You get this because you turned on daily picks. ` +
    `<a href="${settingsUrl}" style="color:${C.link};text-decoration:none;">Turn it off in Settings</a>.</p>`;

  const bodyText = [
    DAILY_PICKS_BASIS,
    ...(languages ? [`${languages} Change the languages: ${languagesUrl}`] : []),
    "",
    ...model.picks.map((item) => [`- ${item.title}`, `  ${metaParts(item).join(" · ")}`, `  ${item.why}`, `  ${item.href}`, ...moreText(item)].join("\n")),
    "",
    `Open Today on Velai: ${model.siteUrl}/jobs`,
    `You get this because you turned on daily picks. Turn it off in Settings: ${settingsUrl}`,
  ].join("\n");

  const shell = { siteUrl: model.siteUrl, unsubscribeUrl: model.unsubscribeUrl, heading: "Today's picks for you" };
  return {
    subject,
    html: renderEmailShellHtml({ ...shell, preheader: escapeHtml(preheader), bodyHtml }),
    text: renderEmailShellText({ ...shell, preheader: "", bodyText }),
  };
}
