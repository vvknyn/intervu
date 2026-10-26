import type { ResumeData } from "@/types/resume";

/**
 * All of a résumé's free text that's relevant for matching against a job:
 * the generated summary, every experience bullet, every project bullet, every
 * skill, every degree and course, and every line of a section the résumé
 * names itself ("Certifications", "Publications", "Volunteering"). Single source for "the résumé's matchable text" — used both
 * to infer duty/role-family signals (duty-signals.ts) and to build the
 * résumé's topical vocabulary for relevance scoring (score.ts). Reading
 * experience alone left a résumé with content ONLY in projects or ONLY in
 * skills producing no matchable text at all; this covers every place a
 * résumé's substance can live.
 */
export function resumeMatchText(resume: ResumeData): string {
    const parts: string[] = [];

    const summary = (resume.generatedSummary ?? "").trim();
    if (summary) parts.push(summary);

    for (const exp of resume.experience ?? []) {
        const desc = (exp.description ?? "").trim();
        if (desc) parts.push(desc);
    }

    for (const project of resume.projects ?? []) {
        const desc = (project.description ?? "").trim();
        if (desc) parts.push(desc);
    }

    for (const group of resume.competencies ?? []) {
        for (const raw of group?.skills ?? []) {
            const skill = (raw ?? "").trim();
            if (skill) parts.push(skill);
        }
    }

    for (const school of resume.education ?? []) {
        parts.push(...[school.degree, ...(school.coursework ?? [])].map((t) => (t ?? "").trim()).filter(Boolean));
    }

    for (const section of resume.additionalSections ?? []) {
        parts.push(...section.lines.map((line) => line.trim()).filter(Boolean));
    }

    return parts.join("\n");
}
