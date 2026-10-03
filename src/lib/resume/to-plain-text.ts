import { buildContactLine } from "@/lib/resume/contact-line";
import { getSectionOrder, type ResumeData, type ResumeSection } from "@/types/resume";

const HEADINGS: Record<ResumeSection, string> = {
    summary: "SUMMARY",
    experience: "EXPERIENCE",
    projects: "PROJECTS",
    skills: "SKILLS",
    education: "EDUCATION",
};

/** "Role | Company Dates", then the description, the way uploaded résumés lay out an entry. */
function entryLines(title: string, org: string | undefined, dates: string | undefined, description: string | undefined): string[] {
    const head = [title?.trim(), org?.trim()].filter(Boolean).join(" | ");
    const lines = [[head, dates?.trim()].filter(Boolean).join(" ")];
    if (description?.trim()) lines.push(description.trim());
    return lines;
}

function sectionLines(data: ResumeData, section: ResumeSection): string[] {
    switch (section) {
        case "summary":
            return data.generatedSummary?.trim() ? [data.generatedSummary.trim()] : [];
        case "experience":
            return (data.experience ?? []).flatMap((e) => entryLines(e.role, e.company, e.dates, e.description));
        case "projects":
            return (data.projects ?? []).flatMap((p) => entryLines(p.role, p.company, p.dates, p.description));
        case "skills":
            return (data.competencies ?? []).flatMap((c) => {
                const skills = c.skills.map((s) => s.trim()).filter(Boolean).join(", ");
                if (!skills) return [];
                return [c.category?.trim() ? `${c.category.trim()}: ${skills}` : skills];
            });
        case "education":
            return (data.education ?? []).flatMap((ed) => {
                const head = [ed.degree?.trim(), ed.institution?.trim()].filter(Boolean).join(" | ");
                return head ? [[head, ed.year?.toString().trim()].filter(Boolean).join(" ")] : [];
            });
    }
}

/** Name, title and contact lines: the name and contact as the upload printed
 *  them when it was one, else built from the profile. A title the reader
 *  takes from the first role anyway is left out, so the header gains no line
 *  the original didn't have; one stated under the name ("Registered Nurse",
 *  when the first role is "Registered Nurse, ICU") stays. */
function headerLines(data: ResumeData): string[] {
    const { profile, sourceHeader } = data;
    const name = sourceHeader?.nameLine.trim() || profile?.name?.trim();
    const profession = profile?.profession?.trim();
    const title = profession && profession.toLowerCase() !== data.experience?.[0]?.role?.trim().toLowerCase() ? profession : undefined;
    const contact = sourceHeader
        ? sourceHeader.contactLines.map((l) => l.trim())
        : [buildContactLine([profile?.location, profile?.phone, profile?.email, profile?.linkedin, profile?.website])];
    return [name, title, ...contact].filter((l): l is string => !!l);
}

/**
 * A structured résumé as plain text in the layout an uploaded résumé has
 * (name, contact line, section headings in the upload's own words,
 * "Role | Company Dates" entry lines, extra sections such as Certifications
 * where they stood), so `resumeDataFromPlainText` reads it back into the same
 * entries. The copy a role keeps when it's marked Applied
 * (`lib/pursuits/resume-on-apply.ts`) is this text: Download renders it
 * through that same reader, which reads markdown's "# Jane Doe" as the name.
 * Pure, so it runs on the server too; it only writes fields out and never
 * interprets a résumé.
 */
export function resumeDataToPlainText(data: ResumeData): string {
    const out = headerLines(data);
    const extras = (after: ResumeSection | null) => {
        for (const extra of data.additionalSections ?? []) {
            if (extra.after === after && extra.lines.length) out.push("", extra.heading, ...extra.lines);
        }
    };
    extras(null);
    for (const section of getSectionOrder(data)) {
        const lines = sectionLines(data, section);
        if (lines.length) out.push("", data.sectionHeadings?.[section]?.trim() || HEADINGS[section], ...lines);
        extras(section);
    }
    return out.join("\n").trim();
}
