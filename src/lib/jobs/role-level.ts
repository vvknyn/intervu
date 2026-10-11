/**
 * What a job title and a posting's years-of-experience ask say about a role's
 * level, read the same way for a posting and for the role on a résumé. Pure,
 * no imports beyond types, so both resume-match.ts (the candidate's level)
 * and match/score.ts (the role's level) read it without importing each other.
 */
import type { Seniority } from "@/lib/jobs/resume-match";

/** A rank word in a title: "Senior", "Lead", "Director" and up read senior; "Junior", "Intern", "Graduate" read entry. */
const TITLE_SENIOR = /\b(?:senior(?!s|\s+(?:care|living|home|homes|centre|center|services|citizens?)\b)|sr|lead(?!\s+gen)|principal|director|head of|vice president|vp|chief)\b/i;
const TITLE_ENTRY = /\b(?:junior|jr|entry[- ]level|intern|internship|new grad|graduate|trainee|apprentice)\b/i;

/**
 * A title that opens with "Manager" and then names what is managed: "Manager,
 * Customer Success", "Manager of Nursing", "Manager - Payroll". That job runs
 * a team, unlike "Customer Success Manager" or "Account Manager", which name
 * the work someone does themselves. Sophos's "Manager, Customer Success
 * (Enterprise)" asks for 5+ years managing a team and read as the same kind
 * of job as a Technical Account Manager's, at their level (2026-10-11).
 */
const TITLE_RUNS_TEAM = /^\W*manager\s*(?:[,:(|–—-]|of\b)/i;

export interface TitleLevel {
    level: Seniority;
    /** The title runs a team ("Manager, Customer Success"), as opposed to carrying a rank word. */
    runsTeam?: true;
}

/** The level a title names by its rank word or by running a team, or null when it names none. */
export function titleLevel(title: string | null | undefined): TitleLevel | null {
    const text = title ?? "";
    if (TITLE_SENIOR.test(text)) return { level: "senior" };
    if (TITLE_RUNS_TEAM.test(text)) return { level: "senior", runsTeam: true };
    if (TITLE_ENTRY.test(text)) return { level: "entry" };
    return null;
}

/** Years outside this range are extraction noise, not an ask worth stating. */
const MAX_PLAUSIBLE_YEARS = 40;

/** The years of experience a posting asks for (`min_years_experience`), whole, or null when it states none we can trust. */
export function yearsAsked(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_YEARS
        ? Math.round(value)
        : null;
}
