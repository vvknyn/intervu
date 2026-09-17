import type { ResumeData, ResumeSection } from "@/types/resume";

const DEFAULT_ORDER: ResumeSection[] = ["summary", "experience", "projects", "skills", "education"];

/**
 * Renders a `ResumeData` into plain markdown text — the exact string the
 * applications wizard hands to `saveResumeVersionForPursuit` as a pursuit's
 * resume-version snapshot content, and what the tracker's Download button
 * ships back out as a `.md` file. Pure and dependency-free (no PDF/docx
 * tooling), so it runs identically server-side (at file-time) and
 * client-side (an ad-hoc re-download). Sections with no content are
 * omitted rather than printed with a placeholder — degrade by omission,
 * never a lying "N/A".
 */
export function resumeDataToMarkdown(data: ResumeData): string {
    const { profile, experience, competencies, education, generatedSummary, projects } = data;
    const lines: string[] = [];

    lines.push(`# ${profile?.name || "Resume"}`);
    const contactBits = [profile?.profession, profile?.location, profile?.email, profile?.phone].filter(Boolean);
    if (contactBits.length) lines.push(contactBits.join(" · "));
    lines.push("");

    const order = data.sectionOrder?.length ? data.sectionOrder : DEFAULT_ORDER;
    for (const section of order) {
        switch (section) {
            case "summary":
                if (generatedSummary) lines.push("## Summary", "", generatedSummary, "");
                break;
            case "experience":
                if (experience?.length) {
                    lines.push("## Experience", "");
                    for (const e of experience) {
                        lines.push(`### ${e.role} — ${e.company}`, e.dates, "", e.description, "");
                    }
                }
                break;
            case "skills":
                if (competencies?.length) {
                    lines.push("## Skills", "");
                    for (const c of competencies) lines.push(`**${c.category}:** ${c.skills.join(", ")}`);
                    lines.push("");
                }
                break;
            case "education":
                if (education?.length) {
                    lines.push("## Education", "");
                    for (const ed of education) {
                        lines.push(`${ed.degree} — ${ed.institution}${ed.year ? ` (${ed.year})` : ""}`);
                        if (ed.gpa) lines.push(`GPA: ${ed.gpa}`);
                        if (ed.honours?.length) lines.push(`Honours: ${ed.honours.join(", ")}`);
                        if (ed.coursework?.length) lines.push(`Relevant coursework: ${ed.coursework.join(", ")}`);
                        if (ed.activities?.length) lines.push(`Activities: ${ed.activities.join(", ")}`);
                    }
                    lines.push("");
                }
                break;
            case "projects":
                if (projects?.length) {
                    lines.push("## Projects", "");
                    for (const p of projects) {
                        lines.push(`### ${p.role}${p.company ? ` — ${p.company}` : ""}`, p.dates, "", p.description, "");
                    }
                }
                break;
        }
    }

    return lines.join("\n").trim() + "\n";
}
