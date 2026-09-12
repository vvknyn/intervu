/**
 * Deterministic plain-text → structured résumé fields.
 *
 * Used as the always-available local parse path (and as fallback when an
 * on-device model fails or returns unusable JSON). No LLM, no I/O — safe to
 * unit-test with fixture résumés.
 */

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

const SECTION_HEADERS = new Set([
    "summary",
    "professional summary",
    "profile",
    "about",
    "experience",
    "work experience",
    "employment",
    "professional experience",
    "skills",
    "technical skills",
    "core competencies",
    "competencies",
    "education",
    "academic",
]);

const DATE_RANGE_RE =
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|Present|Current|Now)/i;

const BULLET_RE = /^[\s]*[•\-\*●◦▪]\s+/;

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
    if (SECTION_HEADERS.has(line.toLowerCase())) return false;
    if (DATE_RANGE_RE.test(line)) return false;
    if (/^https?:\/\//i.test(line)) return false;
    // Two to four capitalized words (typical name or "Jane Doe, PMP")
    const words = line.replace(/[,|].*$/, "").trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    const capitalized = words.filter((w) => /^[A-Z][a-z'.-]+$/.test(w));
    return capitalized.length >= 2;
}

function looksLikeTitle(line: string): boolean {
    if (line.length < 4 || line.length > 80) return false;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) return false;
    if (SECTION_HEADERS.has(line.toLowerCase())) return false;
    const lower = line.toLowerCase();
    return (
        /\b(engineer|developer|manager|designer|analyst|director|lead|architect|consultant|specialist|coordinator|administrator|scientist|product|programmer|devops|sre)\b/i.test(
            lower,
        ) || /\b(senior|staff|principal|junior|head of|vp|vice president)\b/i.test(lower)
    );
}

function isSectionHeader(line: string): string | null {
    const key = line.toLowerCase().replace(/[:\s]+$/, "");
    if (SECTION_HEADERS.has(key)) return key;
    if (/^(summary|experience|skills|education)\b/i.test(line)) {
        return line.split(/[:\s]/)[0].toLowerCase();
    }
    return null;
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

function parseExperienceBlock(lines: string[]): Omit<ResumeExperience, "id">[] {
    const entries: Omit<ResumeExperience, "id">[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const dateMatch = line.match(DATE_RANGE_RE);
        if (dateMatch) {
            // Line contains dates — try company/role on prior lines
            const dates = dateMatch[0];
            const roleLine = i > 0 ? lines[i - 1] : "";
            const companyLine = i > 1 ? lines[i - 2] : "";
            const descLines: string[] = [];
            i++;
            while (i < lines.length) {
                const next = lines[i];
                if (DATE_RANGE_RE.test(next) && !BULLET_RE.test(next)) break;
                const section = isSectionHeader(next);
                if (section && section !== "experience") break;
                descLines.push(next);
                i++;
            }
            entries.push({
                company: companyLine || "",
                role: roleLine || "",
                dates,
                description: descLines.map((d) => d.replace(BULLET_RE, "• ")).join("\n"),
            });
            continue;
        }

        // Block: company line, role line, dates line, bullets
        if (i + 2 < lines.length && DATE_RANGE_RE.test(lines[i + 2])) {
            const company = lines[i];
            const role = lines[i + 1];
            const dates = lines[i + 2].match(DATE_RANGE_RE)?.[0] ?? lines[i + 2];
            const descLines: string[] = [];
            i += 3;
            while (i < lines.length) {
                const next = lines[i];
                if (DATE_RANGE_RE.test(next) && !BULLET_RE.test(next)) break;
                const section = isSectionHeader(next);
                if (section) break;
                descLines.push(next);
                i++;
            }
            entries.push({
                company,
                role,
                dates,
                description: descLines.map((d) => d.replace(BULLET_RE, "• ")).join("\n"),
            });
            continue;
        }

        i++;
    }

    return entries.slice(0, 12);
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

    // Fallback profession: current/most recent role from experience parsing
    const sections: Record<string, string[]> = {};
    let currentSection = "header";
    sections[currentSection] = [];

    for (const line of lines) {
        const header = isSectionHeader(line);
        if (header) {
            currentSection = header.includes("skill") || header.includes("competen")
                ? "skills"
                : header.includes("edu")
                  ? "education"
                  : header.includes("exp") || header.includes("employ") || header.includes("work")
                    ? "experience"
                    : header.includes("summary") || header.includes("about") || header.includes("profile")
                      ? "summary"
                      : header;
            sections[currentSection] = sections[currentSection] ?? [];
            continue;
        }
        sections[currentSection] = sections[currentSection] ?? [];
        sections[currentSection].push(line);
    }

    const experience = parseExperienceBlock(sections.experience ?? []);
    if (!profession && experience.length > 0) {
        profession = experience[0].role || profession;
    }

    const summaryLines = sections.summary ?? [];
    let generatedSummary = summaryLines.join("\n\n").trim();
    if (!generatedSummary) {
        // First paragraph after header block
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
            yearsOfExperience: 0, // filled by normalize via computeYearsOfExperience
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
