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
    extractWebsite,
    isContactOrPlaceLine,
    isLikelyPlaceSegment,
    sanitizeLocation,
} from "@/lib/resume/contact-line";
import { mergeResumeBulletLines } from "@/lib/resume/merge-bullet-lines";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import type { ResumeCompetencyCategory, ResumeData, ResumeEducation, ResumeExperience, ResumeProfile } from "@/types/resume";

export interface StructuredResumeDraft {
    profile: Partial<ResumeProfile>;
    experience: Omit<ResumeExperience, "id">[];
    projects: Omit<ResumeExperience, "id">[];
    competencies: ResumeCompetencyCategory[];
    education: Omit<ResumeEducation, "id">[];
    generatedSummary: string;
}

const MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** U+0027 straight apostrophe or U+2019 curly apostrophe before 2-digit year (e.g. September '21). */
const APOSTROPHE_YEAR = "(?:['\u2019]\\d{2})";

const DATE_TOKEN = `(?:${MONTH}\\.?\\s+(?:\\d{4}|${APOSTROPHE_YEAR})|\\d{1,2}\\/\\d{4}|\\d{4})`;

/** Requires a range separator — bare graduation years like "2016" do not match. */
const DATE_RANGE_RE = new RegExp(
    `(${DATE_TOKEN})\\s*(?:-|–|—|\\s+to\\s+|\\s+-\\s+)\\s*(${DATE_TOKEN}|Present|Current|Now)`,
    "i",
);

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
    const capitalized = words.filter((w) => /^[A-Z][a-z'.-]+$/.test(w));
    return capitalized.length >= 2;
}

function looksLikeTitle(line: string): boolean {
    if (line.length < 4 || line.length > 80) return false;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) return false;
    if (ALL_SECTION_HEADERS.has(normalizeSectionKey(line))) return false;
    const lower = line.toLowerCase();
    return (
        /\b(engineer|developer|manager|designer|analyst|director|lead|architect|consultant|specialist|coordinator|administrator|scientist|product|programmer|devops|sre|customer success|operations|account|support|success|associate|partner|recruiter|people|talent)\b/i.test(
            lower,
        ) || /\b(senior|staff|principal|junior|head of|vp|vice president)\b/i.test(lower)
    );
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
    // Fuzzy header heuristics only on short lines — prose like "12+ years of experience" must not flip sections.
    if (line.length > 80) return null;
    if (isExperienceHeader(key)) return key;
    if (key.includes("skill") || key.includes("competen") || SKILLS_HEADERS.has(key)) return key;
    if (EDUCATION_HEADERS.has(key) || /\b(education|academic)\b/.test(key)) return key;
    if (SUMMARY_HEADERS.has(key) || key.includes("summary") || key === "about") return key;
    return null;
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

function parseRoleCompanyFromLine(line: string, dates: string): { role: string; company: string } {
    let leftover = line.replace(dates, "").trim();
    leftover = leftover.replace(/\(\s*\)/g, "").replace(/^[\(\[\{]+|[\)\]\},;]+$/g, "").trim();

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

function collectDescriptionLines(lines: string[], startIndex: number): { descLines: string[]; nextIndex: number } {
    const descLines: string[] = [];
    let i = startIndex;
    while (i < lines.length) {
        const next = lines[i];
        if (DATE_RANGE_RE.test(next) && !BULLET_RE.test(next)) break;
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

function parseExperienceBlock(lines: string[]): Omit<ResumeExperience, "id">[] {
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
                const { descLines, nextIndex } = collectDescriptionLines(lines, i + 2);
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

            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 1);
            pushExperienceEntry(entries, company, role, dates, descLines);
            i = nextIndex;
            continue;
        }

        if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextDateMatch = nextLine.match(DATE_RANGE_RE);
            if (nextDateMatch && !BULLET_RE.test(nextLine)) {
                const dates = nextDateMatch[0];
                let { role, company } = parseRoleCompanyFromLine(nextLine, dates);
                if (!role && looksLikeTitle(line)) role = line;
                if (!company && !looksLikeTitle(line) && !DATE_RANGE_RE.test(line)) company = line;
                if (!role && !company) role = line;

                const { descLines, nextIndex } = collectDescriptionLines(lines, i + 2);
                pushExperienceEntry(entries, company, role, dates, descLines);
                i = nextIndex;
                continue;
            }
        }

        if (i + 2 < lines.length && DATE_RANGE_RE.test(lines[i + 2])) {
            const company = lines[i];
            const role = lines[i + 1];
            const dates = lines[i + 2].match(DATE_RANGE_RE)?.[0] ?? lines[i + 2];
            const { descLines, nextIndex } = collectDescriptionLines(lines, i + 3);
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
        if (excluded.has(key)) continue;
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

function placeCandidatesFromLines(lines: string[]): string[] {
    const candidates: string[] = [];
    for (const line of lines) {
        if (isSectionHeader(line)) continue;
        if (BULLET_RE.test(line) || DATE_RANGE_RE.test(line)) continue;
        if (/\b(university|college|school|institute)\b/i.test(line)) continue;
        if (!isContactOrPlaceLine(line) && !isLikelyPlaceSegment(line)) continue;
        if ((looksLikeName(line) || looksLikeTitle(line)) && !isLikelyPlaceSegment(line)) continue;

        const cleaned = line
            .replace(EMAIL_RE, "")
            .replace(PHONE_RE, "")
            .replace(LINKEDIN_RE, "")
            .replace(/\s+/g, " ")
            .trim();

        const segments = cleaned.split(/[·|•|]/).map((s) => s.trim()).filter(Boolean);
        for (const seg of segments) {
            if (isLikelyPlaceSegment(seg)) {
                candidates.push(seg.replace(/^[\s·|•]+|[\s·|•]+$/g, "").trim());
            }
        }
    }
    return candidates;
}

function longestPlace(candidates: string[]): string {
    if (candidates.length === 0) return "";
    return candidates.sort((a, b) => b.length - a.length)[0];
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
    const headerEnd = lines.findIndex((line) => isSectionHeader(line));
    const headerLines = headerEnd === -1 ? lines : lines.slice(0, headerEnd);
    const fromHeader = longestPlace(placeCandidatesFromLines(headerLines));
    if (fromHeader) return fromHeader;
    if (headerEnd === -1) return "";
    return longestPlace(placeCandidatesFromLines(lines.slice(headerEnd)));
}

/** City/region from plain résumé text. Empty when the text has no real place. */
export function locationFromResumePlainText(text: string): string {
    return sanitizeLocation(extractLocation(normalizeLines(text)));
}

const SKILL_CATEGORY_RE = /^([^:]{2,60}):\s*(.+)$/;
const SKILLS_WRAPPER_RE = /^Skills?:\s*(.+)$/i;
const DEGREE_LIKE_RE =
    /\b(b\.?s\.?|m\.?s\.?|mba|ph\.?d\.?|bachelor|master|micromasters?|certificate|diploma)\b/i;

/** Place-like tail tokens when a pipe-delimited education line has 3+ parts. */
const PLACE_TAIL_RE =
    /^(buffalo|urbana-champaign|cambridge|stanford|mit|berkeley|ann arbor|new york|boston)$/i;

function stripSkillsWrapper(line: string): string {
    const m = line.match(SKILLS_WRAPPER_RE);
    return m ? m[1].trim() : line;
}

function unpackCategoryColonItems(items: string[]): ResumeCompetencyCategory[] {
    const categories: ResumeCompetencyCategory[] = [];
    for (const item of items) {
        const match = item.match(SKILL_CATEGORY_RE);
        if (match) {
            const skills = match[2]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
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

function parseSkillsBlock(lines: string[]): ResumeCompetencyCategory[] {
    const categories: ResumeCompetencyCategory[] = [];
    const fallbackSkills: string[] = [];

    for (const rawLine of lines) {
        let cleaned = stripSkillsWrapper(rawLine.replace(BULLET_RE, "").trim());
        if (!cleaned) continue;
        const categoryMatch = cleaned.match(SKILL_CATEGORY_RE);
        if (categoryMatch) {
            const skills = categoryMatch[2]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (skills.length > 0) {
                categories.push({ category: categoryMatch[1].trim(), skills });
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

function joinPipeInstitution(parts: string[]): { degree: string; institution: string } {
    const trimmed = parts.map((p) => p.trim()).filter(Boolean);
    if (trimmed.length === 0) return { degree: "", institution: "" };
    if (trimmed.length === 1) return { degree: trimmed[0], institution: "" };
    if (trimmed.length === 2) {
        return { degree: trimmed[0], institution: trimmed[1] };
    }
    const last = trimmed[trimmed.length - 1];
    const secondLast = trimmed[trimmed.length - 2];
    if (PLACE_TAIL_RE.test(last) || /\bat\b/i.test(secondLast)) {
        const institution = `${secondLast} at ${last}`.replace(/\s+at\s+at\s+/i, " at ");
        return { degree: trimmed.slice(0, -2).join(" | "), institution };
    }
    return { degree: trimmed[0], institution: trimmed.slice(1).join(" | ") };
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

function parseEducationBlock(lines: string[]): Omit<ResumeEducation, "id">[] {
    const entries: Omit<ResumeEducation, "id">[] = [];
    for (const rawLine of lines) {
        const line = rawLine.replace(BULLET_RE, "").trim();
        if (!line) continue;
        const yearMatch = line.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch?.[0] ?? "";
        const withoutYear = year ? line.replace(year, "").replace(/[,|\-–—]\s*$/, "").trim() : line;

        const pipeSplit = withoutYear.split(/\s*\|\s*/);
        if (pipeSplit.length >= 2) {
            const { degree, institution } = joinPipeInstitution(pipeSplit);
            entries.push({ degree, institution, year });
            continue;
        }

        const atSplit = splitDegreeAtInstitution(withoutYear);
        if (atSplit) {
            entries.push({ degree: atSplit.degree, institution: atSplit.institution, year });
        } else {
            entries.push({ degree: withoutYear, institution: "", year });
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
    const lines = normalizeLines(text);
    const contact = extractContact(lines);
    const location = sanitizeLocation(extractLocation(lines));

    let name = "";
    let profession = "";
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        if (!name && looksLikeName(line)) {
            name = line.replace(/[,|].*$/, "").trim();
            continue;
        }
        if (name && !profession && looksLikeTitle(line)) {
            profession = line.trim();
            break;
        }
    }

    const sections: Record<string, string[]> = {};
    let currentSection = "header";
    sections[currentSection] = [];

    for (const line of lines) {
        const header = isSectionHeader(line);
        if (header) {
            currentSection = resolveSection(header);
            sections[currentSection] = sections[currentSection] ?? [];
            continue;
        }
        sections[currentSection] = sections[currentSection] ?? [];
        sections[currentSection].push(line);
    }

    let experience = parseExperienceBlock(sections.experience ?? []);
    if (experience.length === 0) {
        experience = parseExperienceBlock(collectExperienceFallbackLines(sections));
    }

    const projects = parseExperienceBlock(sections.projects ?? []);

    if (!profession && experience.length > 0) {
        profession = experience[0].role || profession;
    }

    const tempExperience: ResumeExperience[] = experience.map((exp, idx) => ({
        ...exp,
        id: `exp-${idx + 1}`,
    }));
    const summaryLines = sections.summary ?? [];
    let generatedSummary = summaryLines.join("\n\n").trim();
    if (!generatedSummary) {
        const headerEnd = lines.findIndex((l, idx) => idx > 2 && (isSectionHeader(l) || DATE_RANGE_RE.test(l)));
        const bodyStart = name ? 1 : 0;
        const bodyEnd = headerEnd > 0 ? headerEnd : Math.min(lines.length, 6);
        generatedSummary = lines.slice(bodyStart + (profession ? 1 : 0), bodyEnd).join(" ").trim();
        if (generatedSummary.length > 500) generatedSummary = generatedSummary.slice(0, 500);
    }

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
        },
        experience,
        projects,
        competencies: normalizeCompetencyCategories(parseSkillsBlock(sections.skills ?? [])),
        education: parseEducationBlock(sections.education ?? []),
        generatedSummary,
    };
}
