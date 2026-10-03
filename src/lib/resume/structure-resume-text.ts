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
} from "@/lib/resume/contact-line";
import { markdownResumeToPlainText } from "@/lib/resume/markdown-text";
import { mergeResumeBulletLines } from "@/lib/resume/merge-bullet-lines";
import { unwrapHardWrappedLines } from "@/lib/resume/unwrap-lines";
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import { DATE_RANGE_RE, MONTH } from "./resume-dates";
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

const SUMMARY_HEADERS = new Set(["summary", "professional summary", "profile", "about"]);

const SKILLS_HEADERS = new Set(["skills", "technical skills", "core competencies", "competencies"]);

const EDUCATION_HEADERS = new Set(["education", "academic", "education & professional development"]);

const PROJECTS_HEADERS = new Set(["independent projects", "projects", "selected projects"]);

const ALL_SECTION_HEADERS = new Set([
    ...EXPERIENCE_HEADERS,
    ...SUMMARY_HEADERS,
    ...SKILLS_HEADERS,
    ...EDUCATION_HEADERS,
    ...PROJECTS_HEADERS,
]);

function normalizeSectionKey(line: string): string {
    return line
        .toLowerCase()
        .replace(/[:;.,!?]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isExperienceHeader(key: string): boolean {
    if (EXPERIENCE_HEADERS.has(key)) return true;
    if (key.includes("exp") && !key.includes("expert")) return true;
    if (key.includes("employ")) return true;
    if (key.includes("career")) return true;
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

function resolveSection(header: string): string {
    const key = normalizeSectionKey(header);
    if (key.includes("skill") || key.includes("competen") || SKILLS_HEADERS.has(key)) return "skills";
    if (PROJECTS_HEADERS.has(key) || /\bindependent projects?\b/.test(key)) return "projects";
    if (key === "projects" || key === "selected projects") return "projects";
    if (EDUCATION_HEADERS.has(key) || /\b(education|academic)\b/.test(key)) return "education";
    if (SUMMARY_HEADERS.has(key) || key.includes("summary") || key === "about") return "summary";
    if (isExperienceHeader(key)) return "experience";
    return key;
}

/** The section a heading line opens ("WORK HISTORY" -> experience), or null
 *  when the line is not a heading or opens a section a résumé export has no
 *  place for ("Certifications"). */
export function resumeSectionOfHeading(line: string): ResumeSection | null {
    const header = isSectionHeader(line);
    if (!header) return null;
    const section = resolveSection(header);
    return (ALL_SECTIONS as readonly string[]).includes(section) ? (section as ResumeSection) : null;
}

function normalizeLines(text: string): string[] {
    return text
        .replace(/\f/g, "\n")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => {
            const trimmed = l.trim();
            if (!trimmed) return "";
            return trimmed.replace(/\s{3,}/g, " | ");
        })
        .filter(Boolean);
}

function looksLikeName(line: string): boolean {
    if (line.length < 3 || line.length > 60) return false;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || LINKEDIN_RE.test(line)) return false;
    if (ALL_SECTION_HEADERS.has(normalizeSectionKey(line))) return false;
    if (DATE_RANGE_RE.test(line)) return false;
    if (/^https?:\/\//i.test(line)) return false;
    const words = line.replace(/[,|].*$/, "").trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    const capitalized = words.filter((w) => /^\p{Lu}[\p{Ll}\p{M}'.-]+$/u.test(w) || NAME_WORD_RE.test(w));
    return capitalized.length >= 2;
}

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
    /^(?:served|led|owned|coordinated|delivered|acted|translated|deployed|overhauled|architected|drove|built|managed|developed|created|implemented|designed|established|improved|increased|reduced|streamlined|facilitated|diagnos)/i;

function looksLikeDescriptionLine(line: string): boolean {
    if (/^\s{2,}/.test(line)) return true;
    if (BULLET_RE.test(line)) return true;
    if (BULLET_VERB_RE.test(line.trim())) return true;
    return false;
}

function looksLikeNextLineCompany(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) return false;
    if (DATE_RANGE_RE.test(trimmed)) return false;
    if (isSectionHeader(trimmed)) return false;
    if (looksLikeDescriptionLine(line)) return false;
    if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 6) return false;
    return true;
}

function isSectionHeader(line: string): string | null {
    if (/^skills?:\s+\S/i.test(line.trim())) return null;
    const key = normalizeSectionKey(line);
    if (ALL_SECTION_HEADERS.has(key)) return key;
    // Fuzzy header heuristics only on heading-shaped lines — a sentence that
    // mentions "experience" or "skills" is prose, not a section break.
    if (line.length > 80 || line.trim().split(/\s+/).length > 5 || /[.!?]$/.test(line.trim())) return null;
    if (isExperienceHeader(key)) return key;
    if (key.includes("skill") || key.includes("competen") || SKILLS_HEADERS.has(key)) return key;
    if (EDUCATION_HEADERS.has(key) || /\b(education|academic)\b/.test(key)) return key;
    if (SUMMARY_HEADERS.has(key) || key.includes("summary") || key === "about") return key;
    return null;
}

/** Headings of sections a résumé carries beyond the five the app models:
 *  certifications, licences, awards, languages... Kept whole and printed
 *  in place, never folded into the job above them. */
const EXTRA_SECTION_RE = /^(?:(?:professional |relevant |selected |key )?(?:certifications?|licen[cs]es?|credentials|awards?|honou?rs?|achievements|accomplishments|publications|presentations|patents|languages?|interests|hobbies|activities|extracurricular activities|volunteering|community involvement|leadership|memberships?|affiliations|professional affiliations|training|courses|coursework|professional development|bar admissions?|admissions|references|additional information|conferences|speaking|research)(?:\s*(?:&|and|\/|,)\s*(?:certifications?|licen[cs]es?|credentials|awards?|honou?rs?|achievements|publications|languages?|interests|activities|memberships?|affiliations|training|courses|admissions|skills|development))*)$/i;

/** The heading of a section beyond the five modelled ones, or null. */
export function extraSectionHeading(line: string): string | null {
    const trimmed = line.trim().replace(/[:;]+$/, "").trim();
    if (!trimmed || trimmed.length > 50 || isSectionHeader(line)) return null;
    return EXTRA_SECTION_RE.test(trimmed) ? trimmed : null;
}

/**
 * A line that starts a block of its own and never continues the line above:
 * a section heading (a known one, or a short all-caps line such as
 * "CORE COMPETENCIES") or a dated role line. Rejoining wrapped lines, at
 * upload (`lib/local-ai/pdf-text-lines.ts`) and on stored text
 * (unwrap-lines.ts), never joins across one.
 */
export function isResumeBoundaryLine(line: string): boolean {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/).length;
    if (isSectionHeader(trimmed) || extraSectionHeading(trimmed)) return true;
    // A dated role line, not a sentence that mentions "2019 to 2021".
    if (DATE_RANGE_RE.test(trimmed) && words <= 12 && !/[.!?]$/.test(trimmed)) return true;
    return /\p{Lu}{3}/u.test(trimmed) && !/[\p{Ll},.!?;|·•]/u.test(trimmed) && words <= 4;
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

function parseRoleCompanyFromLine(line: string, dates: string): { role: string; company: string } {
    let leftover = line.replace(dates, "").trim();
    leftover = trimEdgePunctuation(leftover.replace(/\(\s*\)/g, ""));

    const atMatch = leftover.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch) {
        return { role: atMatch[1].trim(), company: atMatch[2].trim() };
    }

    if (/\s*[|]\s*|\s+[—–-]\s+/.test(leftover)) {
        const parts = leftover.split(/\s*[|]\s*|\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            return assignRoleCompany(parts[0], parts[1]);
        }
    }

    const commaParts = leftover.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
        return assignRoleCompany(commaParts[0], commaParts[1]);
    }

    const cleanedLeftover = leftover.replace(/\s*\|\s*$/g, "").trim();
    if (looksLikeTitle(cleanedLeftover)) return { role: cleanedLeftover, company: "" };
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
    return /\b(19|20)\d{2}\b/.test(line) && !DATE_RANGE_RE.test(line);
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
    if (BULLET_RE.test(line) || DATE_RANGE_RE.test(line)) return "";
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
    const match = line.match(DATE_RANGE_RE);
    if (!match || BULLET_RE.test(line)) return false;
    const rest = trimEdgePunctuation(line.replace(match[0], ""));
    return !rest || looksLikeRealPlaceSegment(rest);
}

/**
 * "Software Engineer | Beta Systems" over a line that holds only its dates:
 * the next entry's header, not the last line of this one's description.
 */
function isRoleLineOverDates(lines: string[], i: number): boolean {
    const line = lines[i];
    if (BULLET_RE.test(line) || DATE_RANGE_RE.test(line) || i + 1 >= lines.length) return false;
    if (line.split(/\s+/).length > 12 || /[.!?;:]$/.test(line) || !ROLE_COMPANY_SPLIT_RE.test(line)) return false;
    return isDateOnlyLine(lines[i + 1]);
}

const HEADER_SMALL_WORD_RE = /^(?:of|and|the|for|in|at|de|du|la|le|&|-|–|—)$/i;

/** Short, capitalised like a name ("Beta Systems", "City of Lethbridge"), not a line about the work. */
function looksLikeHeaderText(line: string): boolean {
    const words = line.trim().split(/\s+/);
    if (words.length > 8 || /[.!?;:%]$/.test(line) || /\d+%/.test(line)) return false;
    if (looksLikeDescriptionLine(line) || ACHIEVEMENT_VERB_RE.test(line.trim()) || DATE_RANGE_RE.test(line)) return false;
    const counted = words.filter((w) => !HEADER_SMALL_WORD_RE.test(w));
    return counted.length > 0 && counted.filter((w) => /^[\p{Lu}\d]/u.test(w)).length * 2 >= counted.length;
}

/** "Beta Systems" / "Software Engineer" / "Mar 2016 – Dec 2019": the next entry's three-line header. */
function isHeaderBlockOverDates(lines: string[], i: number): boolean {
    if (i + 2 >= lines.length || !isDateOnlyLine(lines[i + 2])) return false;
    const [a, b] = [lines[i], lines[i + 1]];
    if (!looksLikeHeaderText(a) || !looksLikeHeaderText(b)) return false;
    return looksLikeTitle(a) || looksLikeTitle(b);
}

function collectDescriptionLines(
    lines: string[],
    startIndex: number,
    anyName = false,
): { descLines: string[]; nextIndex: number } {
    const descLines: string[] = [];
    let i = startIndex;
    while (i < lines.length) {
        const next = lines[i];
        if (DATE_RANGE_RE.test(next) && !BULLET_RE.test(next)) break;
        if (singleDateEntryDate(next, anyName) || isRoleLineOverDates(lines, i) || isHeaderBlockOverDates(lines, i)) break;
        const section = isSectionHeader(next);
        if (section) break;
        descLines.push(next);
        i++;
    }
    return { descLines, nextIndex: i };
}

function pushExperienceEntry(
    entries: Omit<ResumeExperience, "id">[],
    company: string,
    role: string,
    dates: string,
    descLines: string[],
): void {
    const normalizedCompany = company.trim();
    const normalizedRole = role.trim();
    if (!normalizedCompany && !normalizedRole) return;
    const merged = mergeResumeBulletLines(descLines);
    entries.push({
        company: normalizedCompany,
        role: normalizedRole,
        dates,
        description: merged.map((d) => `• ${d}`).join("\n"),
    });
}

/** `anyName`: a Projects block, where an entry needn't be named like a role. */
function parseExperienceBlock(lines: string[], anyName = false): Omit<ResumeExperience, "id">[] {
    const entries: Omit<ResumeExperience, "id">[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const dateMatch = line.match(DATE_RANGE_RE);

        if (dateMatch) {
            const dates = dateMatch[0];
            let { role, company } = parseRoleCompanyFromLine(line, dates);

            if (role && !company && i + 1 < lines.length && looksLikeNextLineCompany(lines[i + 1])) {
                company = lines[i + 1].trim();
                const { descLines, nextIndex } = collectDescriptionLines(lines, i + 2, anyName);
                pushExperienceEntry(entries, company, role, dates, descLines);
                i = nextIndex;
                continue;
            }

            if (!role && i > 0 && !DATE_RANGE_RE.test(lines[i - 1]) && !BULLET_RE.test(lines[i - 1])) {
                const prev = lines[i - 1];
                if (looksLikeTitle(prev)) {
                    role = prev;
                    if (!company && i > 1 && !DATE_RANGE_RE.test(lines[i - 2]) && !BULLET_RE.test(lines[i - 2])) {
                        company = lines[i - 2];
                    }
                } else if (!company) {
                    company = prev;
                    if (!role && i > 1 && !DATE_RANGE_RE.test(lines[i - 2]) && !BULLET_RE.test(lines[i - 2])) {
                        role = lines[i - 2];
                    }
                }
            }

            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 1, anyName);
            pushExperienceEntry(entries, company, role, dates, descLines);
            i = nextIndex;
            continue;
        }

        const singleDate = singleDateEntryDate(line, anyName);
        if (singleDate) {
            const { role, company } = parseRoleCompanyFromLine(line, singleDate);
            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 1, anyName);
            pushExperienceEntry(entries, company, role, singleDate, descLines);
            i = nextIndex;
            continue;
        }

        if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextDateMatch = nextLine.match(DATE_RANGE_RE);
            if (nextDateMatch && !BULLET_RE.test(nextLine)) {
                const dates = nextDateMatch[0];
                let { role, company } = parseRoleCompanyFromLine(nextLine, dates);
                if (!role && !company) {
                    // "Software Engineer | Beta Systems" names both.
                    const own = parseRoleCompanyFromLine(line, "");
                    if (own.role && own.company) ({ role, company } = own);
                }
                if (!role && looksLikeTitle(line)) role = line;
                if (!company && !looksLikeTitle(line) && !DATE_RANGE_RE.test(line)) company = line;
                if (!role && !company) role = line;

                const { descLines, nextIndex } = collectDescriptionLines(lines, i + 2, anyName);
                pushExperienceEntry(entries, company, role, dates, descLines);
                i = nextIndex;
                continue;
            }
        }

        if (i + 2 < lines.length && DATE_RANGE_RE.test(lines[i + 2])) {
            // Company over title is the usual order; title over company when the lines say so.
            const [first, second] = [lines[i], lines[i + 1]];
            const titleFirst =
                (looksLikeTitle(first) && !looksLikeTitle(second)) || (looksLikeCompany(second) && !looksLikeCompany(first));
            const [role, company] = titleFirst ? [first, second] : [second, first];
            const dates = lines[i + 2].match(DATE_RANGE_RE)?.[0] ?? lines[i + 2];
            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 3, anyName);
            pushExperienceEntry(entries, company, role, dates, descLines);
            i = nextIndex;
            continue;
        }

        i++;
    }

    return entries.slice(0, 12);
}

function isContactOrIdentityLine(line: string): boolean {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || LINKEDIN_RE.test(line)) return true;
    if (looksLikeName(line)) return true;
    return false;
}

function collectExperienceFallbackLines(sections: Record<string, string[]>): string[] {
    const excluded = new Set(["skills", "education", "summary"]);
    const result: string[] = [];
    for (const [key, sectionLines] of Object.entries(sections)) {
        if (excluded.has(key) || key.startsWith("extra:")) continue;
        for (const line of sectionLines) {
            if (isLikelyEducationLine(line)) continue;
            if (key === "header" && isContactOrIdentityLine(line)) continue;
            if (key === "header" && looksLikeTitle(line) && !DATE_RANGE_RE.test(line)) continue;
            result.push(line);
        }
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

/** The candidate's name as printed on their name line: "Amara Okafor, RN" → "Amara Okafor". */
function nameOfLine(line: string): string {
    return line.replace(/\s[—–]\s.*$|[,|·•].*$/u, "").trim();
}

/** Index of the name line: the first name-shaped line above any section or dated line, or -1. */
function nameLineIndex(lines: string[]): number {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        if (isSectionHeader(line) || extraSectionHeading(line) || DATE_RANGE_RE.test(line)) return -1;
        if (looksLikeName(line)) return i;
    }
    return -1;
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
        if (BULLET_RE.test(line) || DATE_RANGE_RE.test(line)) continue;
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
    /(?<![\p{L}])(?:bachelor|master|doctor(?:ate)?|associate|micromasters?|certificate|diploma|m\.?b\.?a|ph\.?\s?d|[bm]\.?\s?(?:sc|s|a|tech|eng|com|arch|ed|des|fa|phil)\.?|ll\.?[bm]|j\.?d)(?![\p{L}])/iu;

/** Words that name a school in the languages our résumés arrive in. */
const INSTITUTION_RE =
    /(?<![\p{L}])(?:universit\p{L}*|college|coll[eè]ge|institut\p{L}*|school|academy|acad[eé]mie|polytechnic|politecnico|hochschule|escola|escuela|école)(?![\p{L}])/iu;

function stripSkillsWrapper(line: string): string {
    const m = line.match(SKILLS_WRAPPER_RE);
    return m ? m[1].trim() : line;
}

/** Splits "SQL, LLM Integration (Claude, OpenAI), Next.js" on the commas
 *  outside brackets, so a parenthesised list stays one skill. */
function splitSkillList(text: string): string[] {
    const skills: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of text) {
        if (ch === "(" || ch === "[") depth++;
        else if ((ch === ")" || ch === "]") && depth > 0) depth--;
        if (ch === "," && depth === 0) {
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

function parseSkillsBlock(lines: string[]): ResumeCompetencyCategory[] {
    const categories: ResumeCompetencyCategory[] = [];
    const fallbackSkills: string[] = [];
    // Each category's list as printed, so a line the PDF wrapped joins it instead of vanishing.
    let lastList = "";

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
            if (continuesSkillLine(lastList, cleaned)) {
                lastList = `${lastList} ${cleaned}`;
                categories[categories.length - 1].skills = splitSkillList(lastList);
            } else {
                const skills = splitSkillList(cleaned);
                if (skills.length > 0) categories.push({ category: "", skills });
                lastList = cleaned;
            }
            continue;
        }
        const parts = cleaned.split(/[,;|•]/).map((s) => s.trim()).filter(Boolean);
        for (const part of parts) {
            if (part.length > 1) fallbackSkills.push(part);
        }
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

/** Pure: one education line → the slots it fills. Strong separators (| — ·) split before commas. */
function parseEducationLine(line: string): Omit<ResumeEducation, "id"> {
    const year = line.match(/\b(?:19|20)\d{2}\b/g)?.at(-1) ?? "";
    const rest = line
        .replace(DATE_RANGE_RE, "")
        .replace(new RegExp(`(?:${MONTH}\\.?\\s+)?\\b(?:19|20)\\d{2}\\b`, "gi"), "")
        .replace(/\(\s*\)/g, "")
        .replace(/^[\s,;|·•—–-]+|[\s,;|·•—–-]+$/g, "");
    if (!rest) return { degree: "", institution: "", year };
    const strong = rest.split(/\s*[|·•]\s*|\s+[—–-]\s+/).filter(Boolean);
    const commas = rest.split(/\s*,\s*/).filter(Boolean);
    // A comma alone separates a school only when a part names one; otherwise it
    // is inside the degree (`M.B.A., General Business Administration`).
    const parts = strong.length > 1 ? strong : commas.some((p) => INSTITUTION_RE.test(p)) ? commas : [rest];
    return { ...assignDegreeInstitution(parts.map((p) => p.trim())), year };
}

/**
 * One entry may span lines (`ETH Zürich` / `M.Sc. Computer Science, 2016`):
 * a line joins the open entry while it fills only slots that entry still
 * has empty, and starts a new entry otherwise. `Label: value` lines (GPA,
 * coursework) are details, not slots.
 */
function parseEducationBlock(lines: string[]): Omit<ResumeEducation, "id">[] {
    const entries: Omit<ResumeEducation, "id">[] = [];
    for (const rawLine of lines) {
        const line = rawLine.replace(BULLET_RE, "").trim();
        if (!line || /^[^:]{2,30}:\s/.test(line)) continue;
        const parsed = parseEducationLine(line);
        const open = entries.at(-1);
        const slots = ["degree", "institution", "year"] as const;
        if (open && slots.every((k) => !parsed[k] || !open[k])) {
            for (const k of slots) open[k] = open[k] || parsed[k] || "";
        } else {
            entries.push(parsed);
        }
    }
    return entries.slice(0, 6);
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
    const lines = unwrapHardWrappedLines(normalizeLines(markdownResumeToPlainText(text)), isResumeBoundaryLine);
    const contact = extractContact(lines);
    const location = sanitizeLocation(extractLocation(lines));
    const unconfirmedPlaces = location ? [] : barePlacesFromHeader(lines);

    let name = "";
    let profession = "";
    const nameAt = nameLineIndex(lines);
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        // A headline sits above the first section; past it (or on a dated line) a title-ish
        // line is a job entry, not the candidate's headline.
        if (isSectionHeader(line) || extraSectionHeading(line) || DATE_RANGE_RE.test(line)) break;
        if (i === nameAt) {
            name = nameOfLine(line);
            continue;
        }
        if (name && !profession && looksLikeTitle(line)) {
            profession = cleanRoleTitle(line);
            if (profession) break;
        }
    }

    // The header as printed ("Amara Okafor, RN", "Calgary, AB · email · phone"),
    // so an export can keep its wording and order instead of reassembling it.
    const firstBoundary = lines.findIndex((l) => isSectionHeader(l) || extraSectionHeading(l) || DATE_RANGE_RE.test(l));
    const headerLines = lines.slice(0, firstBoundary >= 0 ? firstBoundary : Math.min(lines.length, 6));
    const nameLine = name ? headerLines.find((l) => l.startsWith(name)) : undefined;
    const sourceContactLines = headerLines.filter((l) => l !== nameLine && l.length <= 200 && isContactOrPlaceLine(l));
    const sourceHeader: ResumeSourceHeader | null =
        nameLine || sourceContactLines.length > 0 ? { nameLine: nameLine ?? "", contactLines: sourceContactLines } : null;

    const sections: Record<string, string[]> = {};
    let currentSection = "header";
    sections[currentSection] = [];
    // The source's own section order and heading words, so an export can
    // follow the original instead of a fixed template order.
    const sectionOrder: ResumeSection[] = [];
    const sectionHeadings: Partial<Record<ResumeSection, string>> = {};
    const extras: Array<{ key: string; heading: string; after: ResumeSection | null }> = [];

    for (const line of lines) {
        const extraHeading = extraSectionHeading(line);
        if (extraHeading) {
            currentSection = `extra:${extras.length}`;
            extras.push({ key: currentSection, heading: extraHeading, after: sectionOrder[sectionOrder.length - 1] ?? null });
            sections[currentSection] = [];
            continue;
        }
        const header = isSectionHeader(line);
        if (header) {
            currentSection = resolveSection(header);
            sections[currentSection] = sections[currentSection] ?? [];
            const known = resumeSectionOfHeading(line);
            if (known && !sectionOrder.includes(known)) {
                sectionOrder.push(known);
                sectionHeadings[known] = line.trim().replace(/[:;]+$/, "").trim();
            }
            continue;
        }
        sections[currentSection] = sections[currentSection] ?? [];
        sections[currentSection].push(line);
    }

    let experience = parseExperienceBlock(sections.experience ?? []);
    if (experience.length === 0) {
        experience = parseExperienceBlock(collectExperienceFallbackLines(sections));
    }

    const projects = parseExperienceBlock(sections.projects ?? [], true);

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
        const headerEnd = lines.findIndex((l, idx) => idx > 2 && (isSectionHeader(l) || extraSectionHeading(l) || DATE_RANGE_RE.test(l)));
        const bodyStart = name ? 1 : 0;
        const bodyEnd = headerEnd > 0 ? headerEnd : Math.min(lines.length, 6);
        generatedSummary = lines
            .slice(bodyStart + (profession ? 1 : 0), bodyEnd)
            .filter((l) => !isContactOrPlaceLine(l))
            .join(" ")
            .trim();
        if (generatedSummary.length > 500) generatedSummary = generatedSummary.slice(0, 500);
    }

    const additionalSections: ResumeAdditionalSection[] = extras
        .map((extra) => ({
            heading: extra.heading,
            after: extra.after,
            lines: (sections[extra.key] ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
        }))
        .filter((extra) => extra.lines.length > 0);

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
        competencies: normalizeCompetencyCategories(parseSkillsBlock(sections.skills ?? [])),
        education: parseEducationBlock(sections.education ?? []),
        generatedSummary,
        ...(sectionOrder.length > 0 ? { sectionOrder, sectionHeadings } : {}),
        ...(additionalSections.length > 0 ? { additionalSections } : {}),
        ...(sourceHeader ? { sourceHeader } : {}),
    };
}
