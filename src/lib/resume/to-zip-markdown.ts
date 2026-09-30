import { buildContactLine, sanitizeLocation } from "@/lib/resume/contact-line";
import { descriptionToBullets } from "@/lib/resume/merge-bullet-lines";
import { normalizeCompetencyCategories } from "@/lib/resume/structure-resume-text";
import { getSectionOrder, type ResumeData, type ResumeSection } from "@/types/resume";

/**
 * Zip-shaped markdown for the HTML/CSS → PDF pipeline. Inspectable intermediate
 * between tailored `ResumeData` and `parseResumeContent` — same contact and
 * competency rules as `resumeDataToParsedDocument`, but serialized as markdown
 * so the PDF path always goes through the text layer.
 */
export function resumeDataToZipMarkdown(data: ResumeData): string {
    const lines: string[] = [];
    const name = data.profile?.name?.trim() || data.profile?.profession?.trim() || "Resume";

    lines.push(`# ${name}`);

    const contactLine = buildContactLine([
        sanitizeLocation(data.profile?.location),
        data.profile?.phone,
        data.profile?.email,
        data.profile?.linkedin,
        data.profile?.website,
    ]);
    if (contactLine) lines.push(contactLine);
    lines.push("");

    const renderSection: Record<ResumeSection, () => void> = {
        summary: () => {
            if (data.generatedSummary?.trim()) {
                lines.push("## PROFESSIONAL SUMMARY", "", data.generatedSummary.trim(), "");
            }
        },
        skills: () => {
            const competencies = normalizeCompetencyCategories(data.competencies ?? []);
            if (competencies.length > 0) {
                lines.push("## CORE COMPETENCIES", "");
                for (const c of competencies) {
                    lines.push(c.category.trim() ? `**${c.category}:** ${c.skills.join(", ")}` : c.skills.join(", "));
                }
                lines.push("");
            }
        },
        experience: () => {
            if (data.experience?.length) {
                lines.push("## PROFESSIONAL EXPERIENCE", "");
                for (const e of data.experience) {
                    lines.push(`### ${e.role} | ${e.company}`);
                    if (e.dates?.trim()) lines.push(e.dates.trim());
                    lines.push("");
                    for (const bullet of descriptionToBullets(e.description)) {
                        lines.push(`- ${bullet}`);
                    }
                    lines.push("");
                }
            }
        },
        projects: () => {
            if ((data.projects?.length ?? 0) > 0) {
                lines.push("## INDEPENDENT PROJECTS", "");
                for (const p of data.projects ?? []) {
                    const title = p.company ? `${p.role} | ${p.company}` : p.role;
                    lines.push(`### ${title}`);
                    if (p.dates?.trim()) lines.push(p.dates.trim());
                    lines.push("");
                    for (const bullet of descriptionToBullets(p.description)) {
                        lines.push(`- ${bullet}`);
                    }
                    lines.push("");
                }
            }
        },
        education: () => {
            if (data.education?.length) {
                lines.push("## EDUCATION & PROFESSIONAL DEVELOPMENT", "");
                for (const ed of data.education) {
                    const degree = ed.degree.trim();
                    const institution = ed.institution.trim();
                    const year = ed.year?.trim() ?? "";
                    if (institution && year) lines.push(`- ${degree} | ${institution} | ${year}`);
                    else if (institution) lines.push(`- ${degree} | ${institution}`);
                    else if (year) lines.push(`- ${degree} | ${year}`);
                    else if (degree) lines.push(`- ${degree}`);
                    if (ed.gpa?.trim()) lines.push(`- GPA: ${ed.gpa.trim()}`);
                    if (ed.honours?.length) lines.push(`- Honours: ${ed.honours.join(", ")}`);
                    if (ed.coursework?.length) lines.push(`- Relevant coursework: ${ed.coursework.join(", ")}`);
                    if (ed.activities?.length) lines.push(`- Activities: ${ed.activities.join(", ")}`);
                }
                lines.push("");
            }
        },
    };

    for (const section of getSectionOrder(data)) renderSection[section]();

    return lines.join("\n").trim() + "\n";
}
