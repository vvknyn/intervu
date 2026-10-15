/**
 * What a job title and a posting's years-of-experience ask say about a role's
 * level, read the same way for a posting and for the role on a résumé. Pure,
 * no imports beyond types, so both resume-match.ts (the candidate's level)
 * and match/score.ts (the role's level) read it without importing each other.
 */
import type { Seniority } from "@/lib/jobs/resume-match";
import type { ResumeData } from "@/types/resume";

/** A rank word in a title: "Senior", "Lead", "Director" and up read senior; "Junior", "Intern", "Graduate", "Co-op student" read entry. */
const TITLE_SENIOR = /\b(?:senior(?!s|\s+(?:care|living|home|homes|centre|center|services|citizens?)\b)|sr|lead(?!\s+gen)|principal|director|head of|vice president|vp|chief)\b/i;
const TITLE_ENTRY = /\b(?:junior|jr|entry[- ]level|intern|internship|new grad|graduate|trainee|apprentice|co-?op (?:student|placement|term|position))\b/i;

/** The entry words that mean the role itself is entry level. "Graduate" can name a degree ("Graduate Studies Coordinator"), so it is not one. */
const TITLE_ENTRY_EXPLICIT = /\b(?:junior|jr|entry[- ]level|intern|internship|new grad|trainee|apprentice)\b/i;

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
    /** An entry word that is not a rank word elsewhere in the title: "Junior", "Intern", "Entry Level", "Trainee". */
    explicit?: true;
}

/** The level a title names by its rank word or by running a team, or null when it names none. */
export function titleLevel(title: string | null | undefined): TitleLevel | null {
    const text = title ?? "";
    if (TITLE_SENIOR.test(text)) return { level: "senior" };
    if (TITLE_RUNS_TEAM.test(text)) return { level: "senior", runsTeam: true };
    if (TITLE_ENTRY.test(text)) return { level: "entry", ...(TITLE_ENTRY_EXPLICIT.test(text) ? { explicit: true as const } : {}) };
    return null;
}

/**
 * Ranks past Senior. Staff, Principal and Distinguished are the individual-contributor rungs above it,
 * and Director, Head of, VP and Chief the leadership ones, so a Senior candidate is not a fit for them
 * and a Mid one is two rungs short (Vivek, 2026-10-14: a list that was mostly staff-level roles, "way
 * senior to senior roles"). "Staff" is a rank only when it opens the title (or follows a comma) and the
 * title ends in a role: Staff Software Engineer, Staff Product Manager, Staff Technical Account Manager.
 * Staff Accountant, Staff Nurse, Staff Services Manager and Support Staff Manager are ordinary grades,
 * and Vice or Assistant Principal and a Research Fellow are not these ranks either.
 */
const STAFF_NOT_A_RANK = String.raw`(?:services|development|nurse|nursing|accountant|auditor|attorney|counsel|pharmacist|physician|therapist|assistant|associate|writer|sergeant|officer|engagement|relations|training|retention|wellness|scheduler|scheduling)`;
const STAFF_ROLE_NOUN = String.raw`(?:engineer|developer|scientist|designer|architect|researcher|programmer)`;
const STAFF_OPENS = String.raw`(?:^\W*(?:(?:sr|senior)\.?\s+)?|[,|(–—-]\s*)staff\s+(?!${STAFF_NOT_A_RANK}\b)`;
const TITLE_PAST_SENIOR = new RegExp(
    [
        String.raw`\b(?<!vice\s)(?<!assistant\s)(?<!deputy\s)(?<!school\s)principal\b(?!\s+(?:investigator|accountant)\b)`,
        String.raw`\bdistinguished\s+(?:\w+\s+)?(?:engineer|scientist|architect)\b`,
        String.raw`${STAFF_OPENS}(?:(?:[\w&/.-]+\s+){0,3}${STAFF_ROLE_NOUN}|(?:[\w&/.-]+\s+){1,3}manager)\b`,
        String.raw`\b(?:${STAFF_ROLE_NOUN}|manager)\s*,\s*staff\b`,
        String.raw`\bgroup\s+(?:product|program)\s+manager\b`,
        String.raw`\b(?:director|head of|vice president|vp|svp|evp|chief)\b`,
    ].join("|"),
    "i",
);

/** The title ranks past Senior (`TITLE_PAST_SENIOR`). */
export function titlePastSenior(title: string | null | undefined): boolean {
    return TITLE_PAST_SENIOR.test(title ?? "");
}

/** A listing marked Executive (the corpus's level above Lead) is past Senior whatever its title says. */
export function listedPastSenior(level: string | null | undefined): boolean {
    return (level ?? "").trim().toLowerCase() === "executive";
}

/**
 * The résumé shows a role past Senior: a title it held or holds (`titlePastSenior`). Only then is a
 * Staff, Principal or Director role their own level and not a step above it.
 */
export function resumeHoldsPastSenior(resume: ResumeData | null | undefined): boolean {
    if (!resume) return false;
    return [resume.profile?.profession, ...(resume.experience ?? []).map((entry) => entry.role)].some((title) => titlePastSenior(title));
}

/**
 * Titles for managing people besides "Manager, X": "Director, Customer Success", "Head of Support",
 * "VP Sales", "Shift Supervisor", "Engineering Manager", "Store Manager", "Sous Chef", and a ranked
 * "Senior Manager, X" or "Assistant Manager, X". A manager of a kind of work ("Customer Success
 * Manager", "Product Manager", "Account Manager") does that work, and "Lead" leads the work, not the people.
 */
const TITLE_MANAGES_PEOPLE = new RegExp(
    [
        String.raw`\b(?:director|head of|vice president|vp|chief|supervisor|foreman|forewoman|head chef|sous chef|chef de cuisine)\b`,
        String.raw`\b(?:team|people|general|engineering|store|shift|branch|plant|nurse|nursing|restaurant|kitchen|district)\s+manager\b`,
        String.raw`^\W*(?:senior|sr\.?|associate|assistant|deputy)\s+manager\s*(?:[,:(|–—-]|of\b)`,
    ].join("|"),
    "i",
);

/** The title is a job managing people: it runs a team ("Manager, X"), or names a director, head, VP, supervisor or another people manager (`TITLE_MANAGES_PEOPLE`). */
export function titleManagesPeople(title: string | null | undefined): boolean {
    const text = title ?? "";
    return TITLE_RUNS_TEAM.test(text) || TITLE_MANAGES_PEOPLE.test(text);
}

const PEOPLE = "people|staff|employees|reports|team members|members|engineers|developers|designers|analysts|nurses|agents|associates|technicians|workers|representatives|reps|specialists|consultants|managers|teachers|cooks|drivers";

/**
 * Lines on a résumé that say its owner managed people: "managed a team of 6 engineers",
 * "supervised 12 staff", "direct reports", "people management". Leading the work
 * ("led an 8-person team as the client-facing lead", "managed a cross-functional team"),
 * mentoring, or managing accounts, budgets or projects doesn't count.
 */
const MANAGED_PEOPLE = new RegExp(
    [
        String.raw`\b(?:managed|manage|manages|managing|supervised|supervise|supervises|supervising|oversaw|oversee|oversees|overseeing)\s+(?:a|the|my|our)\s+(?:(?!(?:cross[- ]functional|project|virtual|client|customer|account|partner|vendor)\b)[\w-]+\s+){0,2}?(?:team|staff|crew)\b(?!\s+(?:of\s+)?(?:stakeholders|partners|vendors|clients|customers)\b)`,
        String.raw`\b(?:managed|manage|manages|managing|supervised|supervise|supervises|supervising|oversaw|oversee|oversees|overseeing)\s+(?:a\s+(?:team|staff|crew)\s+of\s+)?\d+\+?\s+(?:[\w-]+\s+){0,2}(?:${PEOPLE})\b`,
        String.raw`\bdirect reports?\b`,
        String.raw`\b(?:people|line) manag(?:er|ers|ement|ing)\b`,
    ].join("|"),
    "i",
);

/**
 * The résumé shows its owner managing people: a role whose title manages people
 * (`titleManagesPeople`, the same reading a posting gets), or a line in the
 * summary, a role or the skills that says so (`MANAGED_PEOPLE`).
 */
export function resumeManagedPeople(resume: ResumeData | null | undefined): boolean {
    if (!resume) return false;
    const experience = resume.experience ?? [];
    if (experience.some((entry) => titleManagesPeople(entry.role)) || titleManagesPeople(resume.profile?.profession)) return true;
    const text = [
        resume.generatedSummary ?? "",
        ...experience.map((entry) => entry.description ?? ""),
        ...(resume.competencies ?? []).flatMap((group) => group?.skills ?? []),
    ].join("\n");
    return MANAGED_PEOPLE.test(text);
}

/** Years outside this range are extraction noise, not an ask worth stating. */
const MAX_PLAUSIBLE_YEARS = 40;

/** The years of experience a posting asks for (`min_years_experience`), whole, or null when it states none we can trust. */
export function yearsAsked(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_YEARS
        ? Math.round(value)
        : null;
}
