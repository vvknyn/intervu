/**
 * Role-title hygiene. A résumé line like
 * "Senior Data Analyst — Wealthsimple, Toronto, ON — March 2022 – Present"
 * carries a title, a company, a place and dates; only the title is a title.
 * One extractor (`roleTitleFromLine`) and one validator (`isRoleTitlePhrase`)
 * so every path that yields a title (rules, model, saved profile) and every
 * path that consumes one (search query) agree on what a title is.
 */
import { DATE_RANGE_RE, HAS_DATE_RE } from "./resume-dates";

/**
 * Words that make a line a job title. The first group is software and
 * go-to-market; the rest are the other professions a résumé comes from. Without
 * them "Registered Nurse" read as a company, and the parser swapped a nurse's
 * role and employer (2026-09-30).
 */
export const TITLE_WORD_RE =
    /\b(engineer|developer|manager|designer|analyst|director|lead|architect|consultant|specialist|coordinator|administrator|scientist|product|programmer|devops|sre|customer success|operations|account|support|success|associate|partner|recruiter|people|talent|senior|staff|principal|junior|head of|vp|vice president|nurse|nursing|rn|lpn|rpn|therapist|pathologist|physiotherapist|pharmacist|technologist|technician|assistant|aide|resident|physician|surgeon|paramedic|midwife|dietitian|hygienist|epidemiologist|psychologist|counsell?or|social worker|caregiver|teacher|educator|instructor|professor|lecturer|tutor|librarian|accountant|auditor|bookkeeper|controller|clerk|receptionist|secretary|paralegal|driver|dispatcher|electrician|plumber|welder|machinist|mechanic|carpenter|foreman|operator|cook|chef|server|barista|cashier|supervisor|officer|representative|agent|advisor|adviser|researcher|intern|apprentice|trainee|generalist|labou?rer|worker|crew|handler|picker|packer|stocker|attendant|host|hostess|bartender|housekeeper|cleaner|janitor|custodian|guard|installer|inspector|estimator|surveyor|planner|buyer|merchandiser|stylist|artist|writer|editor|producer|photographer|journalist|translator|interpreter|lawyer|attorney|counsel|solicitor|barrister|judge|banker|teller|underwriter|actuary|economist|strategist|marketer|copywriter|chemist|biologist|veterinarian|dentist|optometrist|radiographer|sonographer|phlebotomist|nanny|courier|porter|firefighter|founder|owner|president|executive|fellow|co-op)\b/i;

/** Company/place/date separators: spaced dashes, pipe, tab, "at"/"@", comma, bullet dot. */
const SEGMENT_SPLIT_RE = /\s+[—–-]\s+|\s*[|\t·•]\s*|\s+(?:at|@)\s+|,\s*|\s{3,}/i;

/** Longest plausible title, in words. */
const MAX_TITLE_WORDS = 8;

/**
 * The title inside one résumé line, or "" when the line holds none.
 * Dates go first (they are never part of a title); then the line is split on every
 * separator style and the first segment that reads as a title wins, so both
 * "Title — Company" and "Company — Title" come back as the title.
 */
export function roleTitleFromLine(line: string): string {
    const withoutDates = line
        .replace(new RegExp(DATE_RANGE_RE.source, "gi"), " ")
        .replace(new RegExp(HAS_DATE_RE.source, "gi"), " ");
    const segments = withoutDates
        .split(SEGMENT_SPLIT_RE)
        .map((s) => s.replace(/^[\s()[\]{}—–\-|,;:]+|[\s()[\]{}—–\-|,;:]+$/g, ""))
        .filter(Boolean);
    return segments.find((s) => TITLE_WORD_RE.test(s) && s.split(/\s+/).length <= MAX_TITLE_WORDS) ?? "";
}

/**
 * True when `phrase` is safe to put in a search query as a role title:
 * no date, no company/location separator, short. Guards the query chokepoint so a
 * dirty stored profile cannot leak "… — March 2022 – Present" into an OR term.
 */
export function isRoleTitlePhrase(phrase: string): boolean {
    const p = (phrase ?? "").trim();
    if (!p || HAS_DATE_RE.test(p)) return false;
    if (/[—–\t]|\s(?:at|@)\s/i.test(p)) return false;
    // "Title, Company, Place" / "Title, Toronto, ON": two commas or a trailing region code.
    if (/,.*,/.test(p) || /,\s*[A-Z]{2}$/.test(p)) return false;
    return p.split(/\s+/).length <= MAX_TITLE_WORDS;
}

/** `phrase` if it is already a clean title, else the title extracted from it ("" when none). */
export function cleanRoleTitle(phrase: string): string {
    const p = (phrase ?? "").trim();
    return isRoleTitlePhrase(p) ? p : roleTitleFromLine(p);
}
