/**
 * Deterministic plain-text → structured résumé fields.
 *
 * Used as the always-available local parse path (and as fallback when an
 * on-device model fails or returns unusable JSON). No LLM, no I/O — safe to
 * unit-test with fixture résumés.
 */

import {
    EMAIL_RE,
    LINKEDIN_RE,
    PHONE_RE,
    barePlaceOf,
    extractWebsite,
    isContactOrPlaceLine,
    isLikelyPlaceSegment,
    looksLikeRealPlaceSegment,
    sanitizeLocation,
    splitTrailingPlace,
} from "@/lib/resume/contact-line";
import { markdownResumeToPlainText } from "@/lib/resume/markdown-text";
import { mergeResumeBulletLines } from "@/lib/resume/merge-bullet-lines";
import { unwrapHardWrappedLines } from "@/lib/resume/unwrap-lines";
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import { ENTRY_DATES_RE, HAS_DATE_RE, MONTH } from "./resume-dates";
import { resumeLayoutLines } from "./resume-layout-lines";
import { TITLE_WORD_RE, cleanRoleTitle } from "./title-text";
import { ALL_SECTIONS, type ResumeAdditionalSection, type ResumeSourceHeader, type ResumeCompetencyCategory, type ResumeData, type ResumeEducation, type ResumeExperience, type ResumeProfile, type ResumeSection } from "@/types/resume";

export interface StructuredResumeDraft {
    profile: Partial<ResumeProfile>;
    experience: Omit<ResumeExperience, "id">[];
    projects: Omit<ResumeExperience, "id">[];
    competencies: ResumeCompetencyCategory[];
    education: Omit<ResumeEducation, "id">[];
    generatedSummary: string;
    /** The sections in the order their headings appear in the source text. */
    sectionOrder?: ResumeSection[];
    /** Each section's heading as the source text words it ("Work History"). */
    sectionHeadings?: Partial<Record<ResumeSection, string>>;
    /** Sections beyond the five modelled ones, in source order. */
    additionalSections?: ResumeAdditionalSection[];
    /** The name and contact lines as the source printed them. */
    sourceHeader?: ResumeSourceHeader;
}

const BULLET_RE = /^[\s]*[•\-\*●◦▪]\s+/;

const EXPERIENCE_HEADERS = new Set([
    "experience",
    "work experience",
    "employment",
    "professional experience",
    "work history",
    "career",
    "career history",
    "employment history",
    "professional background",
    "relevant experience",
    "selected experience",
    "recent experience",
    "positions",
    "roles",
]);

const SUMMARY_HEADERS = new Set([
    "summary",
    "professional summary",
    "profile",
    "about",
    "about me",
    "professional profile",
    "personal profile",
    "career profile",
    "objective",
    "career objective",
    "professional objective",
    "personal statement",
    "overview",
    "professional overview",
]);

const SKILLS_HEADERS = new Set([
    "skills",
    "technical skills",
    "core competencies",
    "competencies",
    "areas of expertise",
    "expertise",
    "technical expertise",
    "key strengths",
    "core strengths",
    "strengths",
    "technologies",
    "tools",
    "tools & technologies",
    "tools and technologies",
    "technical proficiencies",
    "proficiencies",
    "tech stack",
]);

const EDUCATION_HEADERS = new Set([
    "education",
    "academic",
    "education & professional development",
    "qualifications",
    "academic qualifications",
    "educational qualifications",
]);

/** "Education", "Education & Training", "Educational Background", "Continuing Education",
 *  "Academic Background": a heading that starts with the word. Not a subject or skill that
 *  ends in it ("Patient Education", "Special Education", "Physical Education"). */
const EDUCATION_HEADING_RE = /^(?:(?:formal|further|higher|continuing)\s+)?(?:education(?:al)?|academics?)\b/;

const PROJECTS_HEADERS = new Set(["independent projects", "projects", "selected projects"]);

const ALL_SECTION_HEADERS = new Set([
    ...EXPERIENCE_HEADERS,
    ...SUMMARY_HEADERS,
    ...SKILLS_HEADERS,
    ...EDUCATION_HEADERS,
    ...PROJECTS_HEADERS,
]);

/** Numbering or symbols before a heading's words: "01. ", "■ ", "// ", "— ". Not a year. */
const HEADING_LEAD_RE = /^(?:[^\p{L}\p{N}\s]+\s*|\d{1,2}[.)]\s*)+/u;

/** A heading's words without its decoration: "■ ABOUT", "01. WORK EXPERIENCE", "— TOOLS & SKILLS —", "Skills:". */
function headingText(line: string): string {
    // Trimmed a character at a time: a regex for the trailing run re-scans it from every start, quadratic on a long line.
    const chars = Array.from(line.trim().replace(HEADING_LEAD_RE, ""));
    while (chars.length > 0 && !/[\p{L}\p{N})]/u.test(chars[chars.length - 1])) chars.pop();
    return chars.join("");
}

/**
 * A decorated line reads as a heading only when its words look like one:
 * capitals after a list mark ("• SKILLS", never the bullet "• Leadership"),
 * capitalised words after other decoration ("// Education").
 */
function decorationAllowsHeading(line: string): boolean {
    const lead = line.trim().match(HEADING_LEAD_RE)?.[0];
    if (!lead) return true;
    const words = headingText(line);
    if (lead.includes("•")) return !/\p{Ll}/u.test(words);
    return words.split(/\s+/).every((w) => /^[\p{Lu}&]/u.test(w) || HEADER_SMALL_WORD_RE.test(w));
}

function normalizeSectionKey(line: string): string {
    return headingText(line).toLowerCase().replace(/\s+/g, " ").trim();
}

/** The kind of work named just before "Experience" in its heading, whatever words lead it
 *  ("Relevant Work Experience", "Summer Internship Experience"); a skill such as "Customer
 *  Experience" or "User Experience" is not a heading. */
const EXPERIENCE_QUALIFIER_RE =
    /^(?:[\p{L}&'-]+\s+)*(?:professional|work|relevant|selected|recent|other|additional|related|previous|prior|volunteer|teaching|clinical|research|industry|international|leadership|military|internship|freelance|consulting|management|technical|legal|nursing|field|practical|job|employment|career|paid|overseas|canadian|us|uk)\s+experiences?$/u;

function isExperienceHeader(key: string): boolean {
    if (EXPERIENCE_HEADERS.has(key)) return true;
    // "Experience", "Experience & Achievements" — but not "Experimentation" or "Experienced Hire".
    if (/^experiences?(?:\s|$)/.test(key)) return true;
    if (EXPERIENCE_QUALIFIER_RE.test(key)) return true;
    // "Employment", "Employment History" — but not the skill "Employee Relations".
    if (/^employment\b/.test(key)) return true;
    if (/^(?:professional\s+)?career\b/.test(key) && !/\b(?:objective|profile|summary|goals?)\b/.test(key)) return true;
    if (key === "positions" || key === "roles") return true;
    if (key.includes("work") && (key.includes("history") || key.includes("experience") || key === "work")) {
        return true;
    }
    if (
        key.includes("background") &&
        (key.includes("professional") || key.includes("work") || key.includes("employment"))
    ) {
        return true;
    }
    if (
        key.includes("history") &&
        (key.includes("work") || key.includes("career") || key.includes("employment"))
    ) {
        return true;
    }
    return false;
}

/** The section a heading's words name ("work history" -> experience), or null. */
function sectionOfKey(key: string): ResumeSection | null {
    if (isSkillsHeadingKey(key)) return "skills";
    if (PROJECTS_HEADERS.has(key)) return "projects";
    if (EDUCATION_HEADERS.has(key) || EDUCATION_HEADING_RE.test(key)) return "education";
    if (SUMMARY_HEADERS.has(key) || key.includes("summary") || key === "about") return "summary";
    if (isExperienceHeader(key)) return "experience";
    return null;
}

function normalizeLines(text: string): string[] {
    return resumeLayoutLines(text, (line) => Boolean(isSectionHeader(line) || extraSectionHeading(line)));
}

function looksLikeName(line: string): boolean {
    if (line.length < 3 || line.length > 60 || PAGE_TITLE_RE.test(line)) return false;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || LINKEDIN_RE.test(line)) return false;
    if (ALL_SECTION_HEADERS.has(normalizeSectionKey(line))) return false;
    if (ENTRY_DATES_RE.test(line)) return false;
    if (/^https?:\/\//i.test(line)) return false;
    const words = line.replace(/[,|].*$/, "").trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    // "JAMES WHITFIELD": a name printed in capitals, which no job title is.
    if (words.every((w) => /^\p{Lu}[\p{Lu}\p{M}'’.-]+$/u.test(w))) return !looksLikeTitle(line);
    const capitalized = words.filter((w) => /^\p{Lu}[\p{Ll}\p{M}'.-]+$/u.test(w) || NAME_WORD_RE.test(w));
    return capitalized.length >= 2;
}

/** What a page calls itself: "Curriculum Vitae", "Europass Curriculum Vitae", "Résumé", "Bio-data". */
const PAGE_TITLE_RE = /^(?:\p{L}+\s+)?(?:curriculum\s+vitae|r[ée]sum[ée]|cv|bio-?data)$/iu;

/** A capitalised name with capitals inside it: "Mei-Ling", "McKenzie", "O'Brien", "DeShawn". */
const NAME_WORD_RE = /^\p{Lu}(?=[\p{L}\p{M}'’.-]*\p{Ll})[\p{L}\p{M}'’.-]+$/u;

function looksLikeTitle(line: string): boolean {
    if (line.length < 4 || line.length > 80) return false;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) return false;
    if (ALL_SECTION_HEADERS.has(normalizeSectionKey(line))) return false;
    return TITLE_WORD_RE.test(line);
}

function looksLikeCompany(text: string): boolean {
    if (!text.trim()) return false;
    if (
        /\b(Inc|LLC|Ltd|Corp|Company|University|Co\.|Group|Health|Systems?|Labs?|Technologies|Solutions)\b/i.test(
            text,
        )
    ) {
        return true;
    }
    const words = text.trim().split(/\s+/);
    if (words.length >= 2 && words.every((w) => /^[A-Z][A-Z&.'-]*$/.test(w))) return true;
    return false;
}

const BULLET_VERB_RE =
    /^(?:served|led|owned|coordinated|delivered|acted|translated|deployed|overhauled|architected|drove|built|managed|developed|created|implemented|designed|established|improved|increased|reduced|streamlined|facilitated|diagnos\w*)\b/i;

function looksLikeDescriptionLine(line: string): boolean {
    if (/^\s{2,}/.test(line)) return true;
    if (BULLET_RE.test(line)) return true;
    if (BULLET_VERB_RE.test(line.trim())) return true;
    return false;
}

function looksLikeNextLineCompany(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) return false;
    if (ENTRY_DATES_RE.test(trimmed)) return false;
    if (isSectionHeader(trimmed)) return false;
    if (looksLikeDescriptionLine(line)) return false;
    if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 6) return false;
    return true;
}

/** The section a heading line opens ("WORK HISTORY" -> experience), or null
 *  when the line is not a heading or opens a section a résumé export has no
 *  place for ("Certifications"). */
function isSectionHeader(line: string): ResumeSection | null {
    if (/^skills?:\s+\S/i.test(line.trim()) || !decorationAllowsHeading(line)) return null;
    const key = normalizeSectionKey(line);
    // Fuzzy header heuristics only on heading-shaped lines — a sentence that
    // mentions "experience" or "skills" is prose, not a section break.
    const prose = line.length > 80 || line.trim().split(/\s+/).length > 5 || /[.!?]$/.test(line.trim());
    return ALL_SECTION_HEADERS.has(key) || !prose ? sectionOfKey(key) : null;
}
export { isSectionHeader as resumeSectionOfHeading };

/** "Skills", "Key Skills", "Core Competencies", "Areas of Expertise". Not the skill
 *  "Cultural Competency": only the plural, or a heading that starts with the word. */
function isSkillsHeadingKey(key: string): boolean {
    return SKILLS_HEADERS.has(key) || key.includes("skill") || /\bcompetencies\b|^competenc/.test(key);
}

/** Headings of sections a résumé carries beyond the five the app models:
 *  certifications, licences, awards, languages... Kept whole and printed
 *  in place, never folded into the job above them. */
const EXTRA_SECTION_NAME = `(?:${[
    "certifications?", "licen[cs]es?", "credentials", "accreditations?", "registrations?", "tickets", "permits", "clearances?",
    "endorsements?", "awards?", "honou?rs?", "achievements", "accomplishments", "recognition", "publications", "presentations",
    "patents", "languages?", "interests", "hobbies", "activities", "extracurricular activities", "volunteering",
    "community involvement", "leadership", "memberships?", "affiliations", "professional affiliations", "training", "courses",
    "coursework", "professional development", "bar admissions?", "admissions", "references", "additional information",
    "conferences", "speaking", "research",
].join("|")})`;
/** "Certifications", "Awards & Honours", "Languages and Skills": one or more of those names. */
const EXTRA_SECTION_RE = new RegExp(`^(?:professional |relevant |selected |key )?${EXTRA_SECTION_NAME}(?:\\s*(?:&|and|\\/|,)\\s*(?:${EXTRA_SECTION_NAME}|skills|development))*$`, "i");

/** The heading of a section beyond the five modelled ones, or null. */
export function extraSectionHeading(line: string): string | null {
    const trimmed = headingText(line);
    if (!trimmed || trimmed.length > 50 || isSectionHeader(line) || !decorationAllowsHeading(line)) return null;
    return EXTRA_SECTION_RE.test(trimmed) ? trimmed : null;
}

/**
 * A line that starts a block of its own and never continues the line above:
 * a section heading (a known one, or a short all-caps line such as
 * "CORE COMPETENCIES"), a dated role line, or a line that opens with a
 * degree ("Bachelors in Sociology", under a school's long line). Rejoining wrapped lines, at
 * upload (`lib/local-ai/pdf-text-lines.ts`) and on stored text
 * (unwrap-lines.ts), never joins across one.
 */
export function isResumeBoundaryLine(line: string): boolean {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/).length;
    if (isSectionHeader(trimmed) || extraSectionHeading(trimmed)) return true;
    // A dated role line, not a sentence that mentions "2019 to 2021".
    if (ENTRY_DATES_RE.test(trimmed) && words <= 12 && !/[.!?]$/.test(trimmed)) return true;
    return DEGREE_LIKE_RE.exec(trimmed)?.index === 0 || isShortCapsLine(trimmed);
}

/** "CORE COMPETENCIES", "RESEARCH INTERESTS": a short line in capitals. */
function isShortCapsLine(line: string): boolean {
    const trimmed = line.trim();
    return /\p{Lu}{3}/u.test(trimmed) && !/[\p{Ll}\p{N},.!?;|·•()]/u.test(trimmed) && trimmed.split(/\s+/).length <= 4;
}

/** Line `i`, or "" before the first line or past the last: every rule that looks at the lines
 *  around one reads them through this, so none runs off the end of a block. */
function lineAt(lines: string[], i: number): string {
    return lines[i] ?? "";
}

/** "Month-End Close" / "IFRS" / "Consolidation": one word in capitals among lines of one short item each is an item. */
function isItemOfList(lines: string[], i: number): boolean {
    const item = (line: string) => line.trim().split(/\s+/).length <= 4 && !/[,;:|.!?]/.test(line);
    return !/\s/.test(lineAt(lines, i).trim()) && item(lineAt(lines, i - 1)) && item(lineAt(lines, i + 1));
}

function assignRoleCompany(first: string, second: string): { role: string; company: string } {
    const a = first.trim();
    const b = second.trim();
    if (looksLikeCompany(a) && !looksLikeCompany(b)) return { company: a, role: b };
    if (looksLikeCompany(b) && !looksLikeCompany(a)) return { role: a, company: b };
    if (looksLikeTitle(a) && !looksLikeTitle(b)) return { role: a, company: b };
    if (looksLikeTitle(b) && !looksLikeTitle(a)) return { role: b, company: a };
    return { role: a, company: b };
}

const CLOSER_TO_OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Strips separators and stray brackets from both ends, but keeps a closing
 *  bracket that closes one in the text: "Job-Search Platform (live)" keeps its ")". */
function trimEdgePunctuation(text: string): string {
    let out = text.replace(/^[\s(\[{|·•,;—–-]+/, "");
    for (;;) {
        const next = out.replace(/[\s|·•,;—–-]+$/, "");
        const closer = next.slice(-1);
        const opener = CLOSER_TO_OPENER[closer];
        if (opener && next.split(opener).length - 1 < next.split(closer).length - 1) {
            out = next.slice(0, -1);
            continue;
        }
        if (next === out) return out;
        out = next;
    }
}

const STRONG_SEPARATOR_RE = /\s*[|]\s*|\s+[—–-]\s+/;

/**
 * A role line's role and company: "Role | Company | Place", "Role, Company,
 * City, ST", "Company, City, ST". The place printed after the company is not
 * part of its name; a part that names no place ("Role, Company, Team") is.
 */
function parseRoleCompanyFromLine(line: string, dates: string): { role: string; company: string } {
    let leftover = line.replace(dates, "").trim();
    leftover = trimEdgePunctuation(leftover.replace(/\(\s*\)/g, ""));

    const atMatch = leftover.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch) {
        return { role: atMatch[1].trim(), company: atMatch[2].trim() };
    }

    const cells = leftover.split(STRONG_SEPARATOR_RE).map((p) => p.trim()).filter(Boolean);
    // "Role, Company — City, ST" and "Company, City, ST": the place dropped, the rest read by its commas.
    const named = splitTrailingPlace(cells).names;
    const names = named.length === 1 ? splitTrailingPlace(named[0].split(/,\s*/).map((p) => p.trim()).filter(Boolean)).names : named;
    if (names.length >= 2) return assignRoleCompany(names[0], names[1]);
    // "Role | Company, City, ST": the company's cell, whole.
    if (cells.length >= 2) return assignRoleCompany(cells[0], cells[1]);
    const [only = ""] = names;
    if (only !== leftover) {
        return looksLikeTitle(only) && !looksLikeCompany(only) ? { role: only, company: "" } : { role: "", company: only };
    }

    if (looksLikeTitle(leftover)) return { role: leftover, company: "" };
    if (looksLikeCompany(leftover)) return { role: "", company: leftover };
    return { role: leftover, company: "" };
}

function isLikelyEducationLine(line: string): boolean {
    const lower = line.toLowerCase();
    if (
        !/\b(bachelor|master|phd|ph\.d|b\.?s\.?|m\.?s\.?|mba|degree|university|college|institute|school)\b/i.test(
            lower,
        )
    ) {
        return false;
    }
    return /\b(19|20)\d{2}\b/.test(line) && !ENTRY_DATES_RE.test(line);
}

/** A lone year, month-year or season-year closing a line ("… 2019", "… Summer 2018"). */
const SINGLE_DATE_TAIL_RE = new RegExp(
    String.raw`(?:^|[\s|,·–—(-])\(?((?:(?:${MONTH}\.?|Spring|Summer|Fall|Autumn|Winter)\s+)?(?:19|20)\d{2})\)?\s*$`,
    "i",
);
/** What starts a sentence about the work, not the name of a role or project. */
const ACHIEVEMENT_VERB_RE =
    /^(?:awarded|promoted|received|won|named|recognized|recognised|selected|earned|completed|achieved|wrote|ran|reviewed|presented|published|joined|graduated|started|moved|returned)\b/i;
/** A line that stops mid-phrase ("… completed in 2021") is a sentence, not an entry. */
const TRAILING_LINK_WORD_RE = /\b(?:in|on|at|by|since|from|of|the|a|an|to|until|during|for|and|or|with)$/i;
/** "Role | Company", "Role — Company", "Role at Company", "Role, Company". */
const ROLE_COMPANY_SPLIT_RE = /\S\s*(?:\||\s[—–-]\s|\s(?:at|@)\s|,\s)\s*\S/i;

/**
 * A role or project dated with a single year on its own line: "Survey
 * Technician | Alberta Geomatics 2009", "Open-source culvert sizing
 * calculator 2019". Returns the date, or "" when the line is a sentence
 * that happens to end in a year. In Experience the rest of the line must
 * read as a role ("Role | Company" or a title), so an unbulleted "Employee
 * of the Month 2021" stays with its job; in Projects (`anyName`) any name
 * will do.
 */
function singleDateEntryDate(line: string, anyName: boolean): string {
    if (BULLET_RE.test(line) || ENTRY_DATES_RE.test(line)) return "";
    const match = line.match(SINGLE_DATE_TAIL_RE);
    if (!match) return "";
    const head = trimEdgePunctuation(line.slice(0, match.index).replace(/\(\s*$/, ""));
    if (head.length < 3 || head.length > 80 || !/^[\p{Lu}\d]/u.test(head)) return "";
    if (head.split(/\s+/).length > 10 || /[.!?;:]$/.test(head)) return "";
    if (/\b(?:19|20)\d{2}\b/.test(head) || isSectionHeader(head)) return "";
    if (ACHIEVEMENT_VERB_RE.test(head) || BULLET_VERB_RE.test(head) || TRAILING_LINK_WORD_RE.test(head)) return "";
    if (!anyName && !ROLE_COMPANY_SPLIT_RE.test(head) && !looksLikeTitle(head)) return "";
    return match[1];
}

/** A line holding only a date range, maybe with a place ("Jan 2020 – Present", "Toronto, ON | 2019 – 2021"). */
function isDateOnlyLine(line: string): boolean {
    const match = line.match(ENTRY_DATES_RE);
    if (!match || BULLET_RE.test(line)) return false;
    const rest = trimEdgePunctuation(line.replace(match[0], ""));
    return !rest || looksLikeRealPlaceSegment(rest);
}

/**
 * "Software Engineer | Beta Systems" over a line that holds only its dates:
 * the next entry's header, not the last line of this one's description.
 */
function isRoleLineOverDates(lines: string[], i: number): boolean {
    const line = lineAt(lines, i);
    if (BULLET_RE.test(line) || ENTRY_DATES_RE.test(line)) return false;
    if (line.split(/\s+/).length > 12 || /[.!?;:]$/.test(line) || !ROLE_COMPANY_SPLIT_RE.test(line)) return false;
    return isDateOnlyLine(lineAt(lines, i + 1));
}

const HEADER_SMALL_WORD_RE = /^(?:of|and|the|for|in|at|de|du|la|le|&|-|–|—)$/i;

/** Short, capitalised like a name ("Beta Systems", "City of Lethbridge"), not a line about the work. */
function looksLikeHeaderText(line: string): boolean {
    const words = line.trim().split(/\s+/);
    if (words.length > 8 || /[.!?;:%]$/.test(line) || /\d+%/.test(line)) return false;
    if (looksLikeDescriptionLine(line) || ACHIEVEMENT_VERB_RE.test(line.trim()) || ENTRY_DATES_RE.test(line)) return false;
    const counted = words.filter((w) => !HEADER_SMALL_WORD_RE.test(w));
    return counted.length > 0 && counted.filter((w) => /^[\p{Lu}\d]/u.test(w)).length * 2 >= counted.length;
}

/** "Beta Systems" / "Software Engineer": two short lines naming a role and its employer, in either order. */
function isEntryHeaderPair(a: string, b: string): boolean {
    if (!looksLikeHeaderText(a) || !looksLikeHeaderText(b)) return false;
    // "General Labourer" / "Peel Packaging, Mississauga, ON": a title the word list lacks over a company and its place.
    return looksLikeTitle(a) || looksLikeTitle(b) || looksLikeCompany(a) || looksLikeCompany(b) || /,\s*\S/.test(b);
}

/** "Beta Systems" / "Software Engineer" / "Mar 2016 – Dec 2019": the next entry's three-line header. */
function isHeaderBlockOverDates(lines: string[], i: number): boolean {
    return isDateOnlyLine(lineAt(lines, i + 2)) && isEntryHeaderPair(lineAt(lines, i), lineAt(lines, i + 1));
}

/** "Forklift Operator" / "Buckeye Distribution Center, Grove City, OH" / "• Moved…": an entry printed without dates. */
function isHeaderBlockOverBullets(lines: string[], i: number): boolean {
    return BULLET_RE.test(lineAt(lines, i + 2)) && isEntryHeaderPair(lineAt(lines, i), lineAt(lines, i + 1));
}

/** "Peel Packaging, Mississauga, ON": a line whose last comma parts name a place. */
function endsOnPlace(line: string): boolean {
    const parts = line.split(/,\s*/);
    return parts.length >= 3 && looksLikeRealPlaceSegment(parts.slice(-2).join(", "));
}

/** "Drake & Scull, Abu Dhabi" over "Civil Engineer | 2013 – 2017": the next entry's company,
 *  printed above a dated role line that names no company, not the last line of this entry. */
function isCompanyOverDatedRole(lines: string[], i: number): boolean {
    const line = lineAt(lines, i);
    if (BULLET_RE.test(line) || ENTRY_DATES_RE.test(line) || !looksLikeHeaderText(line)) return false;
    const next = lineAt(lines, i + 1);
    const match = next.match(ENTRY_DATES_RE);
    if (!match || BULLET_RE.test(next)) return false;
    const { role, company } = parseRoleCompanyFromLine(next, match[0]);
    return Boolean(role) && !company;
}

/** "Software Engineer" over "Infosys, Mysuru · Jul 2016 – Dec 2020" or over a line of only its
 *  dates or duration, or a title the words miss over its dates and then its company ("Youth
 *  Programmes Facilitator" / "9 months" / "Saathi Collective, Bengaluru, India"): the next
 *  entry's title, not the last line of this entry. */
function isTitleOverDatedCompany(lines: string[], i: number): boolean {
    const line = lineAt(lines, i);
    if (BULLET_RE.test(line) || ENTRY_DATES_RE.test(line)) return false;
    if (!looksLikeHeaderText(line) || looksLikeCompany(line)) return false;
    const next = lineAt(lines, i + 1);
    const match = next.match(ENTRY_DATES_RE);
    if (!match || BULLET_RE.test(next)) return false;
    const datedText = trimEdgePunctuation(next.replace(match[0], "").replace(/\(\s*\)/g, ""));
    if (!looksLikeTitle(line)) return !datedText && readsTitleFirst(line, lineAt(lines, i + 2));
    return !datedText || !looksLikeTitle(datedText);
}

/** Line `i` opens the next entry (or section), so it is no line of the entry above. */
function startsEntry(lines: string[], i: number, anyName: boolean): boolean {
    const line = lineAt(lines, i);
    return (
        (ENTRY_DATES_RE.test(line) && !BULLET_RE.test(line)) ||
        Boolean(singleDateEntryDate(line, anyName)) ||
        isRoleLineOverDates(lines, i) ||
        isHeaderBlockOverDates(lines, i) ||
        isHeaderBlockOverBullets(lines, i) ||
        isCompanyOverDatedRole(lines, i) ||
        isTitleOverDatedCompany(lines, i) ||
        Boolean(isSectionHeader(line))
    );
}

function collectDescriptionLines(
    lines: string[],
    startIndex: number,
    anyName = false,
): { descLines: string[]; nextIndex: number } {
    let i = startIndex;
    while (i < lines.length && !startsEntry(lines, i, anyName)) i++;
    return { descLines: lines.slice(startIndex, i), nextIndex: i };
}

const asBullets = (lines: string[]) => mergeResumeBulletLines(lines).map((d) => `• ${d}`).join("\n");

/** `first` over `second` reads as a title over its company. "Peel Packaging, Mississauga, ON" ends on its place: the company line, whatever the title says. */
function readsTitleFirst(first: string, second: string): boolean {
    return (
        (looksLikeTitle(first) && !looksLikeTitle(second)) ||
        (looksLikeCompany(second) && !looksLikeCompany(first)) ||
        (endsOnPlace(second) && !endsOnPlace(first))
    );
}

/**
 * The entries of a work history. `anyName`: a Projects block, where an entry
 * needn't be named like a role. A line no entry is read from stays with the
 * entry above it; above the first, it is the block's own text (`intro`).
 */
function parseExperienceBlock(lines: string[], anyName = false): { entries: Omit<ResumeExperience, "id">[]; intro: string[] } {
    const entries: Omit<ResumeExperience, "id">[] = [];
    const intro: string[] = [];
    let unread: number[] = [];
    const keep = (kept: string[]) => {
        const last = entries.at(-1);
        if (!last) intro.push(...kept);
        else if (kept.length > 0) last.description = [last.description, asBullets(kept)].filter(Boolean).join("\n");
    };
    /** `header`: the lines the entry was named from, kept if they name nothing; `used`: unread lines above it that did. */
    const push = (company: string, role: string, dates: string, descLines: string[], header: string[], used: number[] = []) => {
        keep(unread.filter((n) => !used.includes(n)).map((n) => lines[n]));
        unread = [];
        if (!company.trim() && !role.trim()) return keep([...header, ...descLines]);
        entries.push({ company: company.trim(), role: role.trim(), dates, description: asBullets(descLines) });
    };
    // Company over title is the usual order of a two-line entry header.
    let titleOverCompany = false;
    // The company line over the last title, which the roles under it share.
    let groupCompany = "";
    // Dates printed over the entry they belong to, waiting for its title and company.
    let datesAbove = "";
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const dateMatch = line.match(ENTRY_DATES_RE);
        const pendingDates = datesAbove;
        datesAbove = "";

        if (dateMatch) {
            const dates = dateMatch[0];
            let { role, company } = parseRoleCompanyFromLine(line, dates);

            if (role && !company && looksLikeNextLineCompany(lineAt(lines, i + 1))) {
                company = lines[i + 1].trim();
                const { descLines, nextIndex } = collectDescriptionLines(lines, i + 2, anyName);
                push(company, role, dates, descLines, [line, lines[i + 1]]);
                i = nextIndex;
                continue;
            }

            const used: number[] = [];
            if (!role && i > 0 && !ENTRY_DATES_RE.test(lines[i - 1]) && !BULLET_RE.test(lines[i - 1])) {
                const prev = lines[i - 1];
                const twoAbove = i > 1 && !ENTRY_DATES_RE.test(lines[i - 2]) && !BULLET_RE.test(lines[i - 2]);
                if (looksLikeTitle(prev)) {
                    role = prev;
                    used.push(i - 1);
                    if (!company && twoAbove) {
                        company = lines[i - 2];
                        used.push(i - 2);
                    }
                } else if (!company) {
                    company = prev;
                    used.push(i - 1, ...(twoAbove ? [i - 2] : []));
                    if (twoAbove) role = lines[i - 2];
                }
            }

            // Europass: "01/03/2019 – CURRENT" over "Environmental Consultant" / "Verde Ingeniería – Madrid".
            if (!role && !company && startsEntry(lines, i + 1, anyName)) {
                datesAbove = dates;
                unread.push(i);
                i++;
                continue;
            }

            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 1, anyName);
            push(company, role, dates, descLines, [line], used);
            i = nextIndex;
            continue;
        }

        const singleDate = singleDateEntryDate(line, anyName);
        if (singleDate) {
            const { role, company } = parseRoleCompanyFromLine(line, singleDate);
            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 1, anyName);
            push(company, role, singleDate, descLines, [line]);
            i = nextIndex;
            continue;
        }

        // A bullet is a line of the entry above, never the name of one.
        if (BULLET_RE.test(line)) {
            unread.push(i);
            i++;
            continue;
        }

        if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextDateMatch = nextLine.match(ENTRY_DATES_RE);
            if (nextDateMatch && !BULLET_RE.test(nextLine)) {
                const dates = nextDateMatch[0];
                let { role, company } = parseRoleCompanyFromLine(nextLine, dates);
                // "Primary School Teacher" over "Oakwood Primary School, Manchester · 09/2018 – Present":
                // the line above names the role, the dated line the company and its place.
                const datedText = trimEdgePunctuation(nextLine.replace(dates, "").replace(/\(\s*\)/g, ""));
                if (datedText && looksLikeTitle(line) && !looksLikeCompany(line) && !looksLikeTitle(datedText)) {
                    role = line;
                    company = datedText.split(/\s*[|·,]\s*|\s+[—–-]\s+/)[0];
                }
                // "Software Engineer | Beta Systems" names both.
                const own = !role && !company ? parseRoleCompanyFromLine(line, "") : null;
                if (own?.role && own.company) ({ role, company } = own);
                if (!role && looksLikeTitle(line)) role = line;
                // A line the title words miss is the company, unless the line under the dates reads as it.
                if (!company && !looksLikeTitle(line) && !readsTitleFirst(line, lineAt(lines, i + 2))) company = line;
                if (!role && !company) role = line;
                // LinkedIn prints each role at one company under that company's line: a role naming none is the group's.
                if (role && !company) company = groupCompany;
                // "Research Intern" / "6 months" / "Ontario Health Data Institute, Toronto": the company under the dates.
                const below = i + 2;
                const companyBelow = role && !company && looksLikeHeaderText(lineAt(lines, below)) &&
                    looksLikeNextLineCompany(lineAt(lines, below)) && !startsEntry(lines, below, anyName);
                if (companyBelow) company = lines[below].trim();
                // "Ten years of reporting for lenders." over "Analyst | Firm | 2019 – 2021": a line naming
                // nothing of the entry under it is a line of what came before.
                if (![line, own?.role, own?.company].some((v) => v && (v === role || v === company))) unread.push(i);

                const { descLines, nextIndex } = collectDescriptionLines(lines, companyBelow ? below + 1 : below, anyName);
                push(company, role, dates, descLines, [line, nextLine]);
                i = nextIndex;
                continue;
            }
        }

        const datedBelow = !BULLET_RE.test(lineAt(lines, i + 1)) && ENTRY_DATES_RE.test(lineAt(lines, i + 2));
        if (datedBelow || isHeaderBlockOverBullets(lines, i)) {
            const [first, second] = [lines[i], lines[i + 1]];
            // Where the lines don't say ("Diet Technician" / "Bridgetown Senior Living"), the entry
            // keeps the order the ones above it used.
            const titleFirst: boolean = readsTitleFirst(first, second) || (!readsTitleFirst(second, first) && titleOverCompany);
            titleOverCompany = titleFirst;
            const [role, company] = titleFirst ? [first, second] : [second, first];
            groupCompany = titleFirst ? "" : company;
            const dates = datedBelow ? lines[i + 2].match(ENTRY_DATES_RE)?.[0] ?? lines[i + 2] : pendingDates;
            const { descLines, nextIndex } = collectDescriptionLines(lines, datedBelow ? i + 3 : i + 2, anyName);
            push(company, role, dates, descLines, [first, second], pendingDates ? [i - 1] : []);
            i = nextIndex;
            continue;
        }

        if (anyName) {
            // "Open Recipe Search — a semantic search demo…": an undated project's name, what it is, then its bullets.
            const cut = line.match(STRONG_SEPARATOR_RE);
            const name = cut ? line.slice(0, cut.index) : line;
            const about = cut ? line.slice((cut.index ?? 0) + cut[0].length) : "";
            let end = i + 1;
            while (end < lines.length && (BULLET_RE.test(lines[end]) || /^\p{Ll}/u.test(lines[end]))) end++;
            push("", name, "", [about, ...lines.slice(i + 1, end)].filter(Boolean), [line]);
            i = end;
            continue;
        }

        unread.push(i);
        i++;
    }

    keep(unread.map((n) => lines[n]));
    return { entries, intro };
}

/** "HACCP, Menu Costing, Fish Butchery, Sauces": a line that only lists short items, none a date or a way to reach someone. */
function isListLine(line: string): boolean {
    const items = line.split(/\s*[,|·•]\s*/).filter(Boolean);
    return items.length >= 4 && items.every((item) => item.split(/\s+/).length <= 4) &&
        !HAS_DATE_RE.test(line) && !/[.!?]$/.test(line) && !isContactOrPlaceLine(line);
}

/**
 * A header line that is the candidate's, not a job's: how to reach them, a
 * skills list, or their name or headline unless it heads the dated entry
 * under it ("Chef de Partie, The Harbour Hotel, Cork" over "May 2021 – Present").
 */
function isIdentityLine(lines: string[], n: number): boolean {
    const line = lines[n];
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || LINKEDIN_RE.test(line) || isListLine(line)) return true;
    if (ENTRY_DATES_RE.test(line) || ENTRY_DATES_RE.test(lineAt(lines, n + 1))) return false;
    return looksLikeName(line) || looksLikeTitle(line);
}

function collectExperienceFallbackLines(sections: Record<string, string[]>): string[] {
    const excluded = new Set(["skills", "education", "summary"]);
    const result: string[] = [];
    for (const [key, sectionLines] of Object.entries(sections)) {
        if (excluded.has(key)) continue;
        sectionLines.forEach((line, n) => {
            if (isLikelyEducationLine(line) || (key === "header" && isIdentityLine(sectionLines, n))) return;
            result.push(line);
        });
    }
    return result;
}

function extractContact(lines: string[]): Partial<ResumeProfile> {
    const joined = lines.join(" ");
    const email = joined.match(EMAIL_RE)?.[0] ?? "";
    const phone = joined.match(PHONE_RE)?.[0] ?? "";
    const linkedin = joined.match(LINKEDIN_RE)?.[0] ?? "";
    const website = extractWebsite(joined);
    return { email, phone, linkedin, website };
}

const CONTACT_DATA_RES = [EMAIL_RE, PHONE_RE, LINKEDIN_RE];

/** A line's `·` `|` `•` segments with its email, phone and LinkedIn removed. */
function placeSegments(line: string): string[] {
    return CONTACT_DATA_RES.reduce((s, re) => s.replace(re, ""), line)
        .replace(/\s+/g, " ")
        .trim()
        .split(/[·|•]/);
}

/** A credential printed after a name: "RN", "MD", "PhD", "P.Eng", "SHRM-CP", "Jr." */
const CREDENTIAL_RE = /^(?:[A-Z]{2,6}(?:-[A-Z]{1,4})?|[A-Z](?:\.[A-Z])+|Ph\.?\s?D|Pharm\.?\s?D|Psy\.?\s?D|[BM]\.?\s?Sc|M\.?\s?Ed|Ed\.?\s?D|[DM]\.?\s?Phil|[MP]\.?\s?Eng|Esq|Jr|Sr)\.?$/u;

/**
 * Credentials that are no place's code. "MD", "PA", "PE", "CA" and "QLD" are
 * credentials and also states or provinces, so they only count as credentials
 * beside one of these: "Priya Shah, PhD, MD" is a name, "Baltimore, MD" a place.
 */
const PLAIN_CREDENTIALS = new Set(
    ("RN BSN MSN DNP LPN CNA CRNA APRN FNP FNP-BC RN-BC CCRN CPA CFA CMA ACCA CIMA FRM CAIA PMP CSM CISSP CISM CISA " +
        "MBA PHD MSC BSC MPH MPA MSW LCSW LMFT LPC PSYD JD LLM ESQ PENG MENG DDS DMD DVM PHARMD DPT OTR RD RDN FACP FACS " +
        "SHRM-CP SHRM-SCP PHR SPHR MFA MED EDD JR SR").split(" "),
);
const plainCredential = (part: string) => PLAIN_CREDENTIALS.has(part.replace(/[.\s]/g, "").toUpperCase());

/**
 * How many leading comma parts of `parts` are credentials: a run of
 * credential-shaped parts with at least one that is no place's code, or 0.
 */
function credentialRun(parts: string[], person = false): number {
    let run = 0;
    while (run < parts.length && CREDENTIAL_RE.test(parts[run].trim())) run++;
    return person || parts.slice(0, run).some(plainCredential) ? run : 0;
}

/** "Dr. Ana Lima": a title only a person carries, so "MD" after it is a degree. */
const HONORIFIC_RE = /^(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.?\s/i;

/** "Name: Grace Mwangi", "Title: Accountant": a header line that labels its value. */
const HEADER_LABEL_RE = /^\p{L}[\p{L} ]{1,18}:\s+/u;

/** The candidate's name as printed on their name line: "Amara Okafor, RN" → "Amara Okafor". */
function nameOfLine(line: string): string {
    return line.replace(HEADER_LABEL_RE, "").replace(/\s[—–]\s.*$|[,|·•].*$/u, "").trim();
}

/**
 * A sidebar printed before the name (LinkedIn's Contact, Top Skills,
 * Languages), read as the page shows it: the name, the headline under it and
 * the rest of that block first. The name is the name-shaped line over a
 * headline, above the main column's first section.
 */
function nameBlockFirst(lines: string[]): string[] {
    if (nameLineIndex(lines) >= 0) return lines;
    const opens = (line: string) => Boolean(isSectionHeader(line) || extraSectionHeading(line));
    const mainColumn = lines.findIndex((line) => (isSectionHeader(line) ?? "skills") !== "skills");
    const at = lines.findIndex((line, i) => (mainColumn < 0 || i < mainColumn) && !opens(line) && looksLikeName(line) && looksLikeTitle(lineAt(lines, i + 1)));
    if (at <= 0) return lines;
    let end = at + 1;
    while (end < lines.length && !opens(lines[end])) end++;
    return [...lines.slice(at, end), ...lines.slice(0, at), ...lines.slice(end)];
}

/** Index of the name line: the first name-shaped line above any section or dated line, or -1. */
function nameLineIndex(lines: string[]): number {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        if (isSectionHeader(line) || extraSectionHeading(line) || ENTRY_DATES_RE.test(line)) return -1;
        if (looksLikeName(line) && !headsNameBlock(line, lineAt(lines, i + 1))) return i;
    }
    return -1;
}

/** "PERSONAL INFORMATION" over "Lucía Fernández García": capitals over a name are its block's heading. */
function headsNameBlock(line: string, next: string): boolean {
    return isShortCapsLine(line) && looksLikeName(next) && !looksLikeTitle(next) && !isContactOrPlaceLine(next);
}

/**
 * The name line without the name and the credentials after it, so they are
 * never read as a place: "Amara Okafor, RN" → "" (RN is no state code),
 * "Dr. Ana Lima, MD" → "" and "Priya Shah, PhD, MD | Toronto, ON" →
 * "| Toronto, ON". A line with no credentials stays whole: a name-shaped
 * place ("Richmond Hill, Ontario") can be taken for the name when the real
 * one is printed in capitals.
 */
function placeTextOfNameLine(line: string): string {
    const [first, ...others] = line.split(/(?=[·|•])/u);
    const parts = first.split(",");
    const run = credentialRun(parts.slice(1), HONORIFIC_RE.test(parts[0].trim()));
    if (run === 0 || !looksLikeName(parts[0])) return line;
    return [parts.slice(1 + run).join(","), ...others].join("");
}

/** "Amara Okafor, RN": a name and its credentials, not a city and its region. */
function isNameWithCredentials(place: string): boolean {
    const parts = place.split(",").map((p) => p.trim());
    return parts.length >= 2 && credentialRun(parts.slice(1)) === parts.length - 1;
}

function placeCandidatesFromLines(lines: string[]): string[] {
    const candidates: string[] = [];
    for (const line of lines) {
        if (isSectionHeader(line)) continue;
        if (BULLET_RE.test(line) || ENTRY_DATES_RE.test(line)) continue;
        if (INSTITUTION_RE.test(line)) continue;

        // A dash joins a qualifier to its place ("Remote — Austin, TX") or a
        // name to it ("Jane Doe — Calgary, Alberta"): the whole segment first.
        for (const seg of placeSegments(line)) {
            const place = [seg, ...seg.split(/\s[—–]\s/)].find((part) => isLikelyPlaceSegment(part));
            if (place && !isNameWithCredentials(place)) candidates.push(sanitizeLocation(place));
        }
    }
    return candidates;
}

/** A place whose country we can name beats one we can't, then the longer one wins. */
function longestPlace(candidates: string[]): string {
    if (candidates.length === 0) return "";
    const known = (place: string) => (resumeCountriesFromLocation(place).length > 0 ? 1 : 0);
    return candidates.sort((a, b) => known(b) - known(a) || b.length - a.length)[0];
}

/**
 * Parse a place from the résumé, not summary prose.
 *
 * The header used to be only the first eight lines. A real city that
 * extraction placed later — still in the header, or on its own line in
 * the body — was left blank while the rest of the parse succeeded.
 * Header lines (everything before the first section) win. A standalone
 * place line after that is the fallback. Bullets and date ranges are
 * not places.
 */
function extractLocation(lines: string[]): string {
    const nameAt = nameLineIndex(lines);
    const header = headerLinesOf(lines).map((line, i) => (i === nameAt ? placeTextOfNameLine(line) : line));
    return (
        longestPlace(placeCandidatesFromLines(header)) ||
        longestPlace(placeCandidatesFromLines(lines.slice(header.length)))
    );
}

/** Lines above the first section header. */
function headerLinesOf(lines: string[]): string[] {
    const headerEnd = lines.findIndex((line) => isSectionHeader(line));
    return headerEnd === -1 ? lines : lines.slice(0, headerEnd);
}

/**
 * Bare place names ("Mississauga") beside the email / phone / LinkedIn in
 * the header — the user confirms which place each is before it becomes a
 * location. Name and headline lines carry no contact data, so "Jane Doe"
 * is never asked about.
 */
function barePlacesFromHeader(lines: string[]): string[] {
    const places = headerLinesOf(lines)
        .filter((line) => CONTACT_DATA_RES.some((re) => re.test(line)))
        .flatMap(placeSegments)
        .map(barePlaceOf)
        .filter(Boolean);
    return [...new Set(places)];
}

/** City/region from plain résumé text. Empty when the text has no real place. */
export function locationFromResumePlainText(text: string): string {
    return sanitizeLocation(extractLocation(normalizeLines(text)));
}

const SKILL_CATEGORY_RE = /^([^:]{2,60}):\s*(.+)$/;
const SKILLS_WRAPPER_RE = /^Skills?:\s*(.+)$/i;
/** A degree name or abbreviation (`B.Sc.`, `BSc (Hons)`, `M.B.A.`, `B.Tech`, `Master of Design`). */
const DEGREE_LIKE_RE =
    /(?<![\p{L}])(?:bachelors?|masters?|doctor(?:ate)?|associate|micromasters?|certificate|diploma|m\.?b\.?a|ph\.?\s?d|[bm]\.?\s?(?:sc|s|a|tech|eng|com|arch|ed|des|fa|phil)\.?|ll\.?[bm]|j\.?d|[bm]\.?\s?(?:asc|ba|sn|ph|pa)|pgce|pgde|pg\s?dip|pg\s?cert|hnd|hnc|btec|gcses?|a[- ]levels?)(?![\p{L}])/iu;

/** Words that name a school in the languages our résumés arrive in. */
const INSTITUTION_RE =
    /(?<![\p{L}])(?:universi\p{L}*|board|college|coll[eè]ge|institut\p{L}*|school|academy|acad[eé]mie|polytechnic|politecnico|hochschule|escola|escuela|école)(?![\p{L}])/iu;

function stripSkillsWrapper(line: string): string {
    const m = line.match(SKILLS_WRAPPER_RE);
    return m ? m[1].trim() : line;
}

/** Splits "SQL, LLM Integration (Claude, OpenAI) | Next.js" on the commas, semicolons, bars and
 *  bullets outside brackets, so a parenthesised list stays one skill. */
function splitSkillList(text: string): string[] {
    const skills: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of text) {
        if (ch === "(" || ch === "[") depth++;
        else if ((ch === ")" || ch === "]") && depth > 0) depth--;
        if (/[,;|•]/.test(ch) && depth === 0) {
            skills.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    skills.push(current);
    return skills.map((s) => s.trim()).filter((s) => s.length > 0);
}

function unpackCategoryColonItems(items: string[]): ResumeCompetencyCategory[] {
    const categories: ResumeCompetencyCategory[] = [];
    for (const item of items) {
        const match = item.match(SKILL_CATEGORY_RE);
        if (match) {
            const skills = splitSkillList(match[2]);
            if (skills.length > 0) {
                categories.push({ category: match[1].trim(), skills });
            }
        } else if (item.trim()) {
            categories.push({ category: "", skills: [item.trim()] });
        }
    }
    return categories;
}

/** Normalize stored `{ category: "Skills", skills: ["Product: …"] }` blobs. */
export function normalizeCompetencyCategories(categories: ResumeCompetencyCategory[]): ResumeCompetencyCategory[] {
    const result: ResumeCompetencyCategory[] = [];
    for (const cat of categories) {
        const name = cat.category.trim();
        if (name === "Skills" || name === "Skill") {
            result.push(...unpackCategoryColonItems(cat.skills));
            continue;
        }
        const unpackedSkills: string[] = [];
        for (const skill of cat.skills) {
            const stripped = stripSkillsWrapper(skill.trim());
            const inner = stripped.match(SKILL_CATEGORY_RE);
            if (inner && !name) {
                const skills = inner[2]
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                if (skills.length > 0) result.push({ category: inner[1].trim(), skills });
            } else {
                unpackedSkills.push(stripped);
            }
        }
        if (unpackedSkills.length > 0) {
            result.push({ category: name, skills: unpackedSkills });
        }
    }
    return result;
}

/** A skills line that carries on the line above: after a trailing comma or an open bracket, or opening on "(", "&" or a lower-case word. */
function continuesSkillLine(previous: string, line: string): boolean {
    if (/[,(&/]\s*$/.test(previous)) return true;
    if ((previous.match(/[([]/g)?.length ?? 0) > (previous.match(/[)\]]/g)?.length ?? 0)) return true;
    return /^[(&/]|^\p{Ll}/u.test(line);
}

/** A list of three or more items that stops mid-item, then a short line with no list of its own:
 *  the printed line wrapped inside the last item ("…, Inventory Ordering, Food" / "Safe"). */
function wrapsListItem(previous: string, line: string): boolean {
    if ((previous.match(/,/g)?.length ?? 0) < 2 || /[,;]\s*$/.test(previous)) return false;
    return !/[,;:|•]/.test(line) && line.split(/\s+/).length <= 3 && !BULLET_RE.test(line);
}

function parseSkillsBlock(lines: string[]): ResumeCompetencyCategory[] {
    const categories: ResumeCompetencyCategory[] = [];
    const fallbackSkills: string[] = [];
    // Each category's list as printed, so a line the PDF wrapped joins it instead of vanishing.
    let lastList = "";
    let previousList = "";

    for (const rawLine of lines) {
        let cleaned = stripSkillsWrapper(rawLine.replace(BULLET_RE, "").trim());
        if (!cleaned) continue;
        const categoryMatch = cleaned.match(SKILL_CATEGORY_RE);
        if (categoryMatch) {
            const skills = splitSkillList(categoryMatch[2]);
            if (skills.length > 0) {
                categories.push({ category: categoryMatch[1].trim(), skills });
                lastList = categoryMatch[2];
            }
            continue;
        }
        if (categories.length > 0) {
            // Once the block has categories, a plain line is never dropped: it continues the
            // category above ("Telemetry, Triage" / "(CTAS)") or is a list of its own.
            if (continuesSkillLine(lastList, cleaned) || wrapsListItem(lastList, cleaned)) {
                lastList = `${lastList} ${cleaned}`;
                categories[categories.length - 1].skills = splitSkillList(lastList);
            } else {
                const skills = splitSkillList(cleaned);
                if (skills.length > 0) categories.push({ category: "", skills });
                lastList = cleaned;
            }
            continue;
        }
        const parts = splitSkillList(cleaned);
        // "…, Inventory Ordering, Food" / "Safe": a comma list wrapped inside an item, not a new item.
        if (wrapsListItem(previousList, cleaned) && fallbackSkills.length > 0 && parts.length > 0) {
            fallbackSkills[fallbackSkills.length - 1] = `${fallbackSkills[fallbackSkills.length - 1]} ${parts.shift()}`;
        }
        // "R" and "C" are skills; a stray "&" or "-" is not.
        for (const part of parts) {
            if (/[\p{L}\p{N}]/u.test(part)) fallbackSkills.push(part);
        }
        previousList = cleaned;
    }

    if (categories.length > 0) return categories;
    if (fallbackSkills.length === 0) return [];
    const unpacked = unpackCategoryColonItems([...new Set(fallbackSkills)]);
    if (unpacked.some((c) => c.category)) return unpacked;
    return [{ category: "", skills: [...new Set(fallbackSkills)] }];
}

function splitDegreeAtInstitution(withoutYear: string): { degree: string; institution: string } | null {
    const atRe = /\s+at\s+/gi;
    let match: RegExpExecArray | null;
    while ((match = atRe.exec(withoutYear)) !== null) {
        const left = withoutYear.slice(0, match.index).trim();
        const right = withoutYear.slice(match.index + match[0].length).trim();
        if (/\bUniversity\s*$/i.test(left)) continue;
        if (!DEGREE_LIKE_RE.test(left)) continue;
        if (!right) continue;
        return { degree: left, institution: right };
    }
    return null;
}

/**
 * Pure: which part of one education line is the degree and which the
 * school, in either order. A part naming a school (University, Institute…)
 * is the institution; without one, the institution is the part at the far
 * end from the degree. Every other part belongs to the degree
 * (`B.Tech, Mechanical Engineering`).
 */
function assignDegreeInstitution(parts: string[]): { degree: string; institution: string } {
    if (parts.length === 1) {
        const at = splitDegreeAtInstitution(parts[0]);
        if (at) return at;
        return DEGREE_LIKE_RE.test(parts[0]) ? { degree: parts[0], institution: "" } : { degree: "", institution: parts[0] };
    }
    let inst = parts.findIndex((p) => INSTITUTION_RE.test(p) && !DEGREE_LIKE_RE.test(p));
    if (inst === -1) inst = DEGREE_LIKE_RE.test(parts[0]) ? parts.length - 1 : 0;
    return { degree: parts.filter((_, i) => i !== inst).join(", "), institution: parts[inst] };
}

/** A school's date as printed: "2016", "June 2016"; "Azerbaijan 2015" is the year 2015: a month starts a word. */
const EDUCATION_DATE_RE = new RegExp(`\\b(?:${MONTH}\\.?\\s+)?(?:19|20)\\d{2}\\b`, "gi");

/** One education line without its dates and edge separators. */
function educationLineText(line: string): string {
    return line
        .replace(ENTRY_DATES_RE, "")
        .replace(EDUCATION_DATE_RE, "")
        .replace(/\(\s*\)/g, "")
        .replace(/^[\s,;|·•—–-]+|[\s,;|·•—–-]+$/g, "");
}

/** Pure: one education line → the slots it fills. Strong separators (| — ·) split before commas. */
function parseEducationLine(line: string): Omit<ResumeEducation, "id"> {
    const year = line.match(EDUCATION_DATE_RE)?.at(-1) ?? "";
    const rest = educationLineText(line);
    if (!rest) return { degree: "", institution: "", year };
    const strong = rest.split(/\s*[|·•]\s*|\s+[—–-]\s+/).filter(Boolean);
    const commas = rest.split(/\s*,\s*/).filter(Boolean);
    // A comma alone separates a school only when a part names one, or the degree before it already
    // names its field (`Certificate III in Electrotechnology, TAFE Queensland`); otherwise it is
    // inside the degree (`M.B.A., General Business Administration`).
    const fieldNamed = commas.length > 1 && DEGREE_LIKE_RE.test(commas[0]) && /\sin\s/i.test(commas[0]);
    const parts = strong.length > 1 ? strong : fieldNamed || commas.some((p) => INSTITUTION_RE.test(p)) ? commas : [rest];
    return { ...assignDegreeInstitution(parts.map((p) => p.trim())), year };
}

/** The field a school's labelled detail fills ("Relevant coursework: …", "GPA: 3.8"). */
const EDUCATION_DETAIL_FIELDS = [
    { field: "coursework", label: /\bcourse/i },
    { field: "honours", label: /\bhono(?:u)?rs?\b|\bawards?\b/i },
    { field: "activities", label: /\bactivit/i },
    { field: "gpa", label: /\bc?gpa\b|\bgrades?\b/i },
] as const;

interface EducationDetail {
    label: string;
    value: string;
}

/** "GPA: 3.8", "Thesis: …": a detail of the school above it. "Bachelor of Science: Biology" is a school's own line. */
function educationDetail(line: string): EducationDetail | null {
    const m = line.match(INLINE_LABEL_RE);
    return m && !/\d/.test(m[1]) && !DEGREE_LIKE_RE.test(m[1]) && !INSTITUTION_RE.test(m[1]) ? { label: m[1].trim(), value: m[2].trim() } : null;
}

/**
 * One entry may span lines (`ETH Zürich` / `M.Sc. Computer Science, 2016`):
 * a line joins the open entry while it fills only slots that entry still
 * has empty, and starts a new entry otherwise. `Label: value` lines are
 * details, not slots: each fills its school's field, and one naming no
 * field (`Thesis: …`) is returned to be kept under its own label.
 */
function parseEducationBlock(lines: string[]): { entries: Omit<ResumeEducation, "id">[]; details: EducationDetail[] } {
    const entries: Omit<ResumeEducation, "id">[] = [];
    const details: EducationDetail[] = [];
    const cleaned = lines.map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean);
    const body = cleaned.filter((l) => !educationDetail(l));
    let n = -1;
    for (const line of cleaned) {
        const detail = educationDetail(line);
        if (detail) {
            const open = entries.at(-1);
            const field = EDUCATION_DETAIL_FIELDS.find((d) => d.label.test(detail.label))?.field;
            if (!open || !field) details.push(detail);
            else if (field === "gpa") open.gpa = detail.value;
            else open[field] = [...(open[field] ?? []), ...detail.value.split(/\s*[,;]\s*/).filter(Boolean)];
            continue;
        }
        n++;
        const previous = body[n - 1] ?? "";
        const following = body[n + 1] ?? "";
        let parsed = parseEducationLine(line);
        const open = entries.at(-1);
        const bareName = !parsed.degree && !parsed.year && Boolean(parsed.institution) && !INSTITUTION_RE.test(line) && !DEGREE_LIKE_RE.test(line);
        // A narrow column wraps a degree: "Bachelor of Commerce," / "Accounting", "Associate of Applied
        // Science in" / "Office Administration", "Diploma in Hospitality" / "Management" over the school.
        if (open?.degree && !open.institution && !open.year && bareName &&
            (/,$/.test(previous) || TRAILING_LINK_WORD_RE.test(previous) || INSTITUTION_RE.test(following))) {
            open.degree = `${open.degree}${/,$/.test(previous) ? "," : ""} ${educationLineText(line)}`;
            continue;
        }
        // "National Institute of Technology" / "Karnataka", "Polytechnic University of the" / "Philippines":
        // a narrow column wrapped the school's name; "Bengaluru, India" under it is where the school is.
        // Neither starts a new entry.
        if (open?.institution && bareName) {
            if (TRAILING_LINK_WORD_RE.test(open.institution) || !looksLikeRealPlaceSegment(line)) {
                open.institution = `${open.institution} ${parsed.institution}`;
            }
            continue;
        }
        // "Ontario Secondary School" / "Diploma" over "Cawthra Park Secondary School": the credential's
        // own name wrapped, and the school follows.
        if (open?.institution && !open.degree && !open.year && /^(?:diploma|certificate)$/i.test(line) &&
            !/\b(?:university|college|institute)\b/i.test(open.institution) && INSTITUTION_RE.test(following)) {
            open.degree = `${open.institution} ${line}`;
            open.institution = "";
            continue;
        }
        // "B.S. Computer Science" / "University of California, Berkeley": with the degree already open,
        // a comma is inside the school's name.
        if (open?.degree && !open.institution && parsed.degree && parsed.institution && !DEGREE_LIKE_RE.test(parsed.degree) &&
            INSTITUTION_RE.test(line)) {
            parsed = { degree: "", institution: educationLineText(line), year: parsed.year };
        }
        const slots = ["degree", "institution", "year"] as const;
        if (open && slots.every((k) => !parsed[k] || !open[k])) {
            for (const k of slots) open[k] = open[k] || parsed[k] || "";
        } else {
            entries.push(parsed);
        }
    }
    return { entries, details };
}

/** "Graduate Internship Experience" inside Work Experience: a heading over some of its roles, whatever words lead it. */
function isExperienceSubheading(line: string): boolean {
    return !BULLET_RE.test(line) && line.trim().split(/\s+/).length <= 4 && /\bexperiences?$/.test(normalizeSectionKey(line)) && looksLikeHeaderText(line);
}

/** "Honors: Dean's list": a label and the line it heads. */
const INLINE_LABEL_RE = /^([^:]{2,40}):\s+(\S.*)$/;

/** "Course | Institution | Year | Percentage" over its first row: a table's column names, not an entry. */
function isTableHeaderRow(lines: string[], i: number): boolean {
    const cells = lines[i].split(" | ").length;
    const next = lineAt(lines, i + 1);
    return cells >= 3 && !/\d/.test(lines[i]) && /\d/.test(next) && next.split(" | ").length >= cells - 1;
}

/** Dated entries, each a role: work history, whatever the heading over it says ("ACADEMIC APPOINTMENTS", "INTERNSHIPS"). */
function readsAsWorkHistory(lines: string[]): boolean {
    const { entries } = parseExperienceBlock(lines);
    return entries.length > 0 && entries.every((e) => ENTRY_DATES_RE.test(e.dates) && looksLikeTitle(e.role) && !DEGREE_LIKE_RE.test(e.role));
}

/**
 * The lines under each heading, in source order. `key` is the modelled
 * section a heading opens ("experience"), "extra" for one beyond them
 * ("Certifications"), "other" for a heading that names nothing we know, and
 * "header" for the lines above the first heading.
 */
interface ResumeBlock {
    key: string;
    heading: string;
    lines: string[];
}

function resumeBlocks(lines: string[]): ResumeBlock[] {
    const headings = lines.filter((l) => isSectionHeader(l) || extraSectionHeading(l));
    // A résumé that prints its headings in capitals prints them all that way: there, "Education
    // Specialist" is a line and "RESEARCH INTERESTS" a heading, whatever their words.
    const capsDoc = headings.filter(isShortCapsLine).length * 2 > headings.length;
    const headingBlock = (line: string): ResumeBlock | null => {
        if (capsDoc && !isShortCapsLine(line) && !ALL_SECTION_HEADERS.has(normalizeSectionKey(line))) return null;
        const extra = extraSectionHeading(line);
        if (extra) return { key: "extra", heading: extra, lines: [] };
        const header = isSectionHeader(line);
        return header ? { key: header, heading: headingText(line), lines: [] } : null;
    };
    const blocks: ResumeBlock[] = [{ key: "header", heading: "", lines: [] }];
    let current = blocks[0];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const unknownHeading = capsDoc && current.key !== "header" && isShortCapsLine(line) && !looksLikeTitle(line) &&
            !startsEntry(lines, i, false) && !isItemOfList(lines, i);
        const opened = headingBlock(line) ?? (unknownHeading ? { key: "other", heading: headingText(line), lines: [] } : null);
        if (opened) {
            blocks.push(opened);
            current = opened;
            continue;
        }
        if (isTableHeaderRow(lines, i) || (current.key === "experience" && isExperienceSubheading(line))) continue;
        // "Skills: REDCap, SPSS" or "Honors: Dean's list" among the extras: a heading and its one line.
        const label = current.key === "extra" || current.key === "other" ? line.match(INLINE_LABEL_RE) : null;
        const labelled = label ? headingBlock(label[1]) : null;
        if (label && labelled) {
            labelled.lines.push(label[2]);
            blocks.push(labelled);
            continue;
        }
        current.lines.push(line);
    }
    for (const block of blocks) {
        if ((block.key === "education" || block.key === "other") && readsAsWorkHistory(block.lines)) block.key = "experience";
    }
    // "Research Internship Experience" over "Organisation: …" lines, after a work history that names
    // its roles: a section of its own, kept under its heading, not more lines of the last job.
    const work = blocks.filter((block) => block.key === "experience");
    const namesRoles = work.map((block) => parseExperienceBlock(block.lines).entries.length > 0);
    if (namesRoles.some(Boolean)) work.forEach((block, n) => { if (!namesRoles[n]) block.key = "other"; });
    return blocks;
}

/** Assign stable ids so a structured draft can enter the ResumeData → HTML PDF path. */
export function structuredDraftToResumeData(draft: StructuredResumeDraft): ResumeData {
    return {
        profile: {
            name: draft.profile.name ?? "",
            profession: draft.profile.profession ?? "",
            yearsOfExperience: draft.profile.yearsOfExperience ?? 0,
            location: draft.profile.location ?? "",
            email: draft.profile.email ?? "",
            phone: draft.profile.phone ?? "",
            linkedin: draft.profile.linkedin,
            website: draft.profile.website,
        },
        experience: draft.experience.map((e, i) => ({ ...e, id: `exp-${i}` })),
        projects: draft.projects.map((e, i) => ({ ...e, id: `proj-${i}` })),
        competencies: draft.competencies,
        education: draft.education.map((e, i) => ({ ...e, id: `edu-${i}` })),
        generatedSummary: draft.generatedSummary,
        ...(draft.sectionOrder && draft.sectionOrder.length > 0 ? { sectionOrder: draft.sectionOrder } : {}),
        ...(draft.sectionHeadings && Object.keys(draft.sectionHeadings).length > 0 ? { sectionHeadings: draft.sectionHeadings } : {}),
        ...(draft.additionalSections && draft.additionalSections.length > 0 ? { additionalSections: draft.additionalSections } : {}),
        ...(draft.sourceHeader ? { sourceHeader: draft.sourceHeader } : {}),
    };
}

/** Plain text → ResumeData without going through parseResumeContent. */
export function resumeDataFromPlainText(text: string): ResumeData {
    return structuredDraftToResumeData(structureResumeText(text));
}

/**
 * Extract structured fields from pasted/uploaded plain-text résumé content.
 */
export function structureResumeText(text: string): StructuredResumeDraft {
    // A PDF uploaded before extraction rejoined wrapped lines is stored one
    // printed line per line; rejoin them here so the summary and skills read
    // like the file (unwrap-lines.ts). Headings and dated role lines stay put.
    // A version an agent filed in markdown reads as its words, not its marks ("# Jane Doe").
    const lines = nameBlockFirst(unwrapHardWrappedLines(normalizeLines(markdownResumeToPlainText(text)), isResumeBoundaryLine));
    const contact = extractContact(lines);
    const location = sanitizeLocation(extractLocation(lines));
    const unconfirmedPlaces = location ? [] : barePlacesFromHeader(lines);

    let name = "";
    let profession = "";
    let professionAt = -1;
    const nameAt = nameLineIndex(lines);
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        // A headline sits above the first section; past it (or on a dated line) a title-ish
        // line is a job entry, not the candidate's headline.
        if (isSectionHeader(line) || extraSectionHeading(line) || ENTRY_DATES_RE.test(line)) break;
        if (i === nameAt) {
            name = nameOfLine(line);
            continue;
        }
        if (name && !profession && looksLikeTitle(line)) {
            profession = cleanRoleTitle(line.replace(HEADER_LABEL_RE, ""));
            professionAt = i;
            if (profession) break;
        }
    }

    // The header as printed ("Amara Okafor, RN", "Calgary, AB · email · phone"),
    // so an export can keep its wording and order instead of reassembling it.
    const firstBoundary = lines.findIndex((l) => isSectionHeader(l) || extraSectionHeading(l) || ENTRY_DATES_RE.test(l));
    const headerLines = lines.slice(0, firstBoundary >= 0 ? firstBoundary : Math.min(lines.length, 6));
    const nameLine = name ? lines[nameAt] : undefined;
    const sourceContactLines = headerLines.filter((l) => l !== nameLine && l.length <= 200 && isContactOrPlaceLine(l));
    const sourceHeader: ResumeSourceHeader | null =
        nameLine || sourceContactLines.length > 0 ? { nameLine: nameLine ?? "", contactLines: sourceContactLines } : null;

    const sections: Record<string, string[]> = {};
    // The source's own section order and heading words, so an export can
    // follow the original instead of a fixed template order.
    const sectionOrder: ResumeSection[] = [];
    const sectionHeadings: Partial<Record<ResumeSection, string>> = {};
    const additionalSections: ResumeAdditionalSection[] = [];
    const blocks = resumeBlocks(lines);
    for (const block of blocks) {
        const known = (ALL_SECTIONS as readonly string[]).includes(block.key) ? (block.key as ResumeSection) : null;
        if (known && !sectionOrder.includes(known)) {
            sectionOrder.push(known);
            sectionHeadings[known] = block.heading;
        }
        if (block.key === "extra" || block.key === "other") {
            const kept = block.lines.map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean);
            if (kept.length > 0) additionalSections.push({ heading: block.heading, after: sectionOrder[sectionOrder.length - 1] ?? null, lines: kept });
        } else {
            (sections[block.key] ??= []).push(...block.lines);
        }
    }

    // A block's own text over its first entry ("Ten years running hotel kitchens."): kept under its heading, where it was printed.
    const keepIntro = (key: ResumeSection, { entries, intro }: ReturnType<typeof parseExperienceBlock>) => {
        const kept = intro.map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean);
        if (kept.length > 0) additionalSections.push({ heading: sectionHeadings[key] ?? "", after: sectionOrder[sectionOrder.indexOf(key) - 1] ?? null, lines: kept });
        return entries;
    };
    // A work history naming no role is read with the rest of the résumé's lines.
    const work = parseExperienceBlock(sections.experience ?? []);
    const experience = work.entries.length > 0 ? keepIntro("experience", work) : parseExperienceBlock(collectExperienceFallbackLines(sections)).entries;

    const projects = keepIntro("projects", parseExperienceBlock(sections.projects ?? [], true));

    if (!profession && experience.length > 0) {
        profession = cleanRoleTitle(experience[0].role) || profession;
    }

    const tempExperience: ResumeExperience[] = experience.map((exp, idx) => ({
        ...exp,
        id: `exp-${idx + 1}`,
    }));
    const summaryLines = sections.summary ?? [];
    let generatedSummary = summaryLines.join("\n\n").trim();
    if (!generatedSummary) {
        // The header's own prose: what is left of it once the name, headline and contact lines are read.
        generatedSummary = headerLines
            .filter((l, idx) => idx !== nameAt && idx !== professionAt && !isContactOrPlaceLine(l) && !isShortCapsLine(l) && !PAGE_TITLE_RE.test(l))
            .join(" ")
            .trim();
        if (generatedSummary.length > 500) generatedSummary = generatedSummary.slice(0, 500);
    }

    // Without a heading, schools are read by their shape.
    const schools = parseEducationBlock(sections.education ?? (sections.header ?? []).filter(isLikelyEducationLine));
    for (const { label, value } of schools.details) additionalSections.push({ heading: label, after: "education", lines: [value] });

    // "LANGUAGE SKILLS", "DIGITAL SKILLS": skills split under several headings are lists named by them.
    // Without a heading, skill lists are read by their shape.
    const skillBlocks = blocks.filter((b) => b.key === "skills");
    // A heading saying no more than its section ("SKILLS") names no list.
    const named = (b: ResumeBlock) => skillBlocks.length > 1 && normalizeSectionKey(b.heading) !== b.key;
    const competencies = skillBlocks.length > 0
        ? skillBlocks.flatMap((b) => parseSkillsBlock(b.lines).map((c) => (named(b) && !c.category ? { ...c, category: b.heading } : c)))
        : parseSkillsBlock((sections.header ?? []).filter(isListLine));

    const computedYoE = computeYearsOfExperience(tempExperience, new Date());
    let yearsOfExperience = computedYoE !== null ? computedYoE : 0;
    if (computedYoE === null) {
        const summaryYoE = generatedSummary.match(/(\d+)\+\s*years/i);
        if (summaryYoE) yearsOfExperience = Number(summaryYoE[1]);
    }

    return {
        profile: {
            name,
            profession,
            yearsOfExperience,
            location,
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            linkedin: contact.linkedin ?? "",
            website: contact.website ?? "",
            ...(unconfirmedPlaces.length > 0 ? { unconfirmedPlaces } : {}),
        },
        experience,
        projects,
        competencies: normalizeCompetencyCategories(competencies),
        education: schools.entries,
        generatedSummary,
        ...(sectionOrder.length > 0 ? { sectionOrder, sectionHeadings } : {}),
        ...(additionalSections.length > 0 ? { additionalSections } : {}),
        ...(sourceHeader ? { sourceHeader } : {}),
    };
}
