/**
 * Deterministic plain-text → structured résumé fields.
 *
 * Used as the always-available local parse path (and as fallback when an
 * on-device model fails or returns unusable JSON). No LLM, no I/O — safe to
 * unit-test with fixture résumés.
 */

import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import type { ResumeCompetencyCategory, ResumeEducation, ResumeExperience, ResumeProfile } from "@/types/resume";

export interface StructuredResumeDraft {
    profile: Partial<ResumeProfile>;
    experience: Omit<ResumeExperience, "id">[];
    competencies: ResumeCompetencyCategory[];
    education: Omit<ResumeEducation, "id">[];
    generatedSummary: string;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i;

const MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const DATE_TOKEN = `(?:${MONTH}\\.?\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;

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

const EDUCATION_HEADERS = new Set(["education", "academic"]);

const ALL_SECTION_HEADERS = new Set([
    ...EXPERIENCE_HEADERS,
    ...SUMMARY_HEADERS,
    ...SKILLS_HEADERS,
    ...EDUCATION_HEADERS,
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
    if (EDUCATION_HEADERS.has(key) || /\b(education|academic)\b/.test(key)) return "education";
    if (SUMMARY_HEADERS.has(key) || key.includes("summary") || key === "about") return "summary";
    if (isExperienceHeader(key)) return "experience";
    return key;
}

function normalizeLines(text: string): string[] {
    return text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
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

function isSectionHeader(line: string): string | null {
    const key = normalizeSectionKey(line);
    if (ALL_SECTION_HEADERS.has(key)) return key;
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
    entries.push({
        company: normalizedCompany,
        role: normalizedRole,
        dates,
        description: descLines.map((d) => d.replace(BULLET_RE, "• ")).join("\n"),
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
    return { email, phone, linkedin };
}

function parseSkillsBlock(lines: string[]): ResumeCompetencyCategory[] {
    const skills: string[] = [];
    for (const line of lines) {
        const cleaned = line.replace(BULLET_RE, "").trim();
        if (!cleaned) continue;
        const parts = cleaned.split(/[,;|•]/).map((s) => s.trim()).filter(Boolean);
        for (const part of parts) {
            if (part.length > 1 && part.length < 60) skills.push(part);
        }
    }
    if (skills.length === 0) return [];
    return [{ category: "Skills", skills: [...new Set(skills)].slice(0, 30) }];
}

function parseEducationBlock(lines: string[]): Omit<ResumeEducation, "id">[] {
    const entries: Omit<ResumeEducation, "id">[] = [];
    for (const line of lines) {
        const yearMatch = line.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch?.[0] ?? "";
        const withoutYear = year ? line.replace(year, "").replace(/[,|\-–—]\s*$/, "").trim() : line;
        const atSplit = withoutYear.split(/\s+at\s+/i);
        if (atSplit.length === 2) {
            entries.push({ degree: atSplit[0].trim(), institution: atSplit[1].trim(), year });
        } else {
            entries.push({ degree: withoutYear, institution: "", year });
        }
    }
    return entries.slice(0, 6);
}

/**
 * Extract structured fields from pasted/uploaded plain-text résumé content.
 */
export function structureResumeText(text: string): StructuredResumeDraft {
    const lines = normalizeLines(text);
    const contact = extractContact(lines);

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

    if (!profession && experience.length > 0) {
        profession = experience[0].role || profession;
    }

    const tempExperience: ResumeExperience[] = experience.map((exp, idx) => ({
        ...exp,
        id: `exp-${idx + 1}`,
    }));
    const computedYoE = computeYearsOfExperience(tempExperience, new Date());
    const yearsOfExperience = computedYoE !== null ? computedYoE : 0;

    const summaryLines = sections.summary ?? [];
    let generatedSummary = summaryLines.join("\n\n").trim();
    if (!generatedSummary) {
        const headerEnd = lines.findIndex((l, idx) => idx > 2 && (isSectionHeader(l) || DATE_RANGE_RE.test(l)));
        const bodyStart = name ? 1 : 0;
        const bodyEnd = headerEnd > 0 ? headerEnd : Math.min(lines.length, 6);
        generatedSummary = lines.slice(bodyStart + (profession ? 1 : 0), bodyEnd).join(" ").trim();
        if (generatedSummary.length > 500) generatedSummary = generatedSummary.slice(0, 500);
    }

    return {
        profile: {
            name,
            profession,
            yearsOfExperience,
            location: "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            linkedin: contact.linkedin ?? "",
        },
        experience,
        competencies: parseSkillsBlock(sections.skills ?? []),
        education: parseEducationBlock(sections.education ?? []),
        generatedSummary,
    };
}
