/**
 * The second half of tailoring a résumé to a job in the panel: putting what
 * the role asks for first, without changing a word. Within each role on the
 * résumé, the lines that use the job's words move up; within each skills
 * group, the skills the job names move to the front. Ties keep the résumé's
 * own order, so nothing moves without a reason the panel can name.
 */
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import type { ResumeData, ResumeExperience } from "@/types/resume";

export interface RoleOrder {
    /** The résumé with lines and skills reordered (a copy; the input is left as it was). */
    resume: ResumeData;
    /** "Registered Nurse · St. Michael's Hospital" for each role whose lines moved. */
    movedRoles: string[];
    /** The skills now at the front because the job names them, in résumé order. */
    leadingSkills: string[];
}

function wordsOf(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]{3,}/gu)?.filter((w) => w.length >= 3) ?? [];
}

/** How many of the job's words a line uses (each word counted once). */
function hits(text: string, terms: ReadonlySet<string>): number {
    let n = 0;
    for (const word of new Set(wordsOf(text))) if (terms.has(word)) n++;
    return n;
}

/** Stable: higher score first, the original order on ties. */
function byScore<T>(items: T[], score: (item: T) => number): T[] {
    return items
        .map((item, i) => ({ item, i, s: score(item) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(({ item }) => item);
}

function reorderEntries(entries: ResumeExperience[], terms: ReadonlySet<string>, moved: string[]): ResumeExperience[] {
    return entries.map((entry) => {
        const bullets = descriptionToBullets(entry.description ?? "");
        if (bullets.length < 2) return entry;
        const ordered = byScore(bullets, (line) => hits(line, terms));
        if (ordered.every((line, i) => line === bullets[i])) return entry;
        moved.push([entry.role, entry.company].filter(Boolean).join(" · "));
        return { ...entry, description: ordered.map((line) => `- ${line}`).join("\n") };
    });
}

/**
 * Pure: `resume` with each role's lines and each skills group ordered by how
 * many of `roleTerms` (the job's words, `roleTermsForJob`) they use.
 */
export function orderForRole(resume: ResumeData, roleTerms: readonly string[]): RoleOrder {
    const terms = new Set(roleTerms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3));
    const movedRoles: string[] = [];
    const leadingSkills: string[] = [];
    const experience = reorderEntries(resume.experience ?? [], terms, movedRoles);
    const projects = resume.projects ? reorderEntries(resume.projects, terms, movedRoles) : resume.projects;
    const competencies = (resume.competencies ?? []).map((group) => {
        const ordered = byScore(group.skills, (skill) => hits(skill, terms));
        if (ordered.every((skill, i) => skill === group.skills[i])) return group;
        leadingSkills.push(...ordered.filter((skill) => hits(skill, terms) > 0));
        return { ...group, skills: ordered };
    });
    return { resume: { ...resume, experience, projects, competencies }, movedRoles, leadingSkills };
}
