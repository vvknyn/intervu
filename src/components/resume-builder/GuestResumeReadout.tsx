"use client";

import { sanitizeLocation } from "@/lib/resume/contact-line";
import { getSectionOrder, type ResumeData, type ResumeEducation, type ResumeSection } from "@/types/resume";
import { cn } from "@/lib/utils";

const DEFAULT_HEADINGS: Record<ResumeSection, string> = {
    summary: "Professional summary",
    experience: "Experience",
    projects: "Projects",
    skills: "Skills",
    education: "Education",
};

/** Stored parses sometimes put the degree in `institution` with an empty `degree`. */
function educationForDisplay(edu: ResumeEducation): { degree: string; institution: string; year: string } {
    let degree = (edu.degree ?? "").trim().replace(/^\|\s*/, "");
    let institution = (edu.institution ?? "").trim();
    const year = (edu.year ?? "").trim();
    if (!degree && institution && !institution.includes("|")) {
        degree = institution;
        institution = "";
    }
    return { degree, institution, year };
}

function splitDescriptionBullets(description: string): string[] {
    return description
        .split(/\n+/)
        .flatMap((line) => line.split(/(?=•\s)/))
        .map((line) => line.replace(/^[\s•·-]+/, "").trim())
        .filter(Boolean);
}

interface GuestResumeReadoutProps {
    data: ResumeData;
    className?: string;
}

/** Readable résumé readout for signed-out /resume — UI typography, not a print preview. */
export function GuestResumeReadout({ data, className }: GuestResumeReadoutProps) {
    const profile = data.profile ?? {};
    const location = sanitizeLocation(profile.location);
    const sectionOrder = getSectionOrder(data);
    const heading = (section: ResumeSection) =>
        data.sectionHeadings?.[section]?.trim() || DEFAULT_HEADINGS[section];

    const subtitleParts = [
        profile.profession?.trim(),
        profile.yearsOfExperience && profile.yearsOfExperience > 0
            ? `${profile.yearsOfExperience} ${profile.yearsOfExperience === 1 ? "yr" : "yrs"} exp`
            : "",
        location,
    ].filter(Boolean);

    const contactInline = [
        profile.email?.trim(),
        profile.phone?.trim(),
        profile.linkedin?.trim()?.replace(/^https?:\/\/(www\.)?/, ""),
        profile.website?.trim()?.replace(/^https?:\/\/(www\.)?/, ""),
    ].filter(Boolean);

    const renderSection = (section: ResumeSection) => {
        switch (section) {
            case "summary": {
                const text = data.generatedSummary?.trim();
                if (!text) return null;
                return (
                    <section key="summary" className="space-y-2 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{heading("summary")}</h3>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{text}</p>
                    </section>
                );
            }
            case "experience": {
                const items = data.experience ?? [];
                if (items.length === 0) return null;
                return (
                    <section key="experience" className="space-y-3.5 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{heading("experience")}</h3>
                        <ul className="space-y-4">
                            {items.map((exp) => (
                                <li key={exp.id} className="space-y-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                                        {exp.role?.trim() ? (
                                            <p className="text-sm font-semibold text-foreground">{exp.role.trim()}</p>
                                        ) : null}
                                        {exp.dates?.trim() ? (
                                            <p className="text-xs text-muted-foreground shrink-0">{exp.dates.trim()}</p>
                                        ) : null}
                                    </div>
                                    {exp.company?.trim() ? (
                                        <p className="text-xs text-muted-foreground">{exp.company.trim()}</p>
                                    ) : null}
                                    {exp.description?.trim() ? (
                                        <ul className="list-disc pl-5 text-sm text-foreground space-y-1 pt-0.5">
                                            {splitDescriptionBullets(exp.description).map((bullet) => (
                                                <li key={bullet}>{bullet}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            }
            case "projects": {
                const items = data.projects ?? [];
                if (items.length === 0) return null;
                return (
                    <section key="projects" className="space-y-3.5 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{heading("projects")}</h3>
                        <ul className="space-y-4">
                            {items.map((proj) => (
                                <li key={proj.id} className="space-y-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                                        {proj.role?.trim() ? (
                                            <p className="text-sm font-semibold text-foreground">{proj.role.trim()}</p>
                                        ) : null}
                                        {proj.dates?.trim() ? (
                                            <p className="text-xs text-muted-foreground shrink-0">{proj.dates.trim()}</p>
                                        ) : null}
                                    </div>
                                    {proj.company?.trim() ? (
                                        <p className="text-xs text-muted-foreground">{proj.company.trim()}</p>
                                    ) : null}
                                    {proj.description?.trim() ? (
                                        <p className="text-sm text-foreground whitespace-pre-line">{proj.description.trim()}</p>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            }
            case "skills": {
                const categories = (data.competencies ?? []).filter((cat) => cat.skills && cat.skills.length > 0);
                if (categories.length === 0) return null;
                return (
                    <section key="skills" className="space-y-2.5 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{heading("skills")}</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {categories.map((cat, index) => (
                                <div
                                    key={cat.category || index}
                                    className="rounded-ctl border border-border bg-surface px-3 py-2 text-xs text-foreground"
                                >
                                    {cat.category.trim() ? (
                                        <p className="leading-relaxed">
                                            <span className="font-semibold text-foreground">{cat.category.trim()}: </span>
                                            <span className="text-muted-foreground">{cat.skills.join(", ")}</span>
                                        </p>
                                    ) : (
                                        <p className="leading-relaxed text-foreground">{cat.skills.join(", ")}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                );
            }
            case "education": {
                const items = data.education ?? [];
                if (items.length === 0) return null;
                return (
                    <section key="education" className="space-y-3.5 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{heading("education")}</h3>
                        <ul className="space-y-3">
                            {items.map((raw) => {
                                const edu = educationForDisplay(raw);
                                if (!edu.degree && !edu.institution) return null;
                                return (
                                    <li key={raw.id} className="space-y-0.5">
                                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                                            {edu.degree ? (
                                                <p className="text-sm font-semibold text-foreground">{edu.degree}</p>
                                            ) : null}
                                            {edu.year ? (
                                                <p className="text-xs text-muted-foreground shrink-0">{edu.year}</p>
                                            ) : null}
                                        </div>
                                        {edu.institution ? (
                                            <p className="text-xs text-muted-foreground">{edu.institution}</p>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            }
            default:
                return null;
        }
    };

    const additionalSections = (data.additionalSections ?? []).filter(
        (sec) => sec.heading?.trim() && sec.lines && sec.lines.some((l) => l.trim().length > 0),
    );

    return (
        <div
            data-testid="guest-resume-readout"
            className={cn(
                "w-full rounded-panel border border-border bg-surface-2 px-5 py-5 text-foreground shadow-[var(--shadow-bevel-inset)]",
                className,
            )}
        >
            <div className="border-b border-border pb-4">
                {profile.name?.trim() ? (
                    <h2 className="text-lg font-semibold text-foreground">{profile.name.trim()}</h2>
                ) : null}
                {subtitleParts.length > 0 ? (
                    <p className="mt-0.5 text-sm text-foreground">
                        {subtitleParts.join(" · ")}
                    </p>
                ) : null}
                {contactInline.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground break-words">
                        {contactInline.join(" · ")}
                    </p>
                ) : null}
            </div>
            <div className="mt-5 space-y-5 divide-y divide-border">
                {sectionOrder.map((section) => renderSection(section))}
                {additionalSections.map((sec) => (
                    <section key={sec.heading} className="space-y-2 pt-5 first:pt-0">
                        <h3 className="text-xs font-semibold text-muted-foreground">{sec.heading.trim()}</h3>
                        <ul className="space-y-1 text-sm text-foreground">
                            {sec.lines
                                .map((l) => l.replace(/^[\s•·-]+/, "").trim())
                                .filter(Boolean)
                                .map((line, idx) => (
                                    <li key={`${sec.heading}-${idx}`}>{line}</li>
                                ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
