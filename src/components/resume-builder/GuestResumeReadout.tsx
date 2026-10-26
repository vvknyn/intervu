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

    const contactFacts: { label: string; value: string }[] = [];
    if (profile.profession?.trim()) contactFacts.push({ label: "Role", value: profile.profession.trim() });
    if (location) contactFacts.push({ label: "Location", value: location });
    if (profile.phone?.trim()) contactFacts.push({ label: "Phone", value: profile.phone.trim() });
    if (profile.email?.trim()) contactFacts.push({ label: "Email", value: profile.email.trim() });
    if (profile.linkedin?.trim()) contactFacts.push({ label: "LinkedIn", value: profile.linkedin.trim() });
    if (profile.website?.trim()) contactFacts.push({ label: "Website", value: profile.website.trim() });

    const renderSection = (section: ResumeSection) => {
        switch (section) {
            case "summary": {
                const text = data.generatedSummary?.trim();
                if (!text) return null;
                return (
                    <section key="summary" className="space-y-2">
                        <h3 className="text-sm font-semibold text-foreground">{heading("summary")}</h3>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{text}</p>
                    </section>
                );
            }
            case "experience": {
                const items = data.experience ?? [];
                if (items.length === 0) return null;
                return (
                    <section key="experience" className="space-y-4">
                        <h3 className="text-sm font-semibold text-foreground">{heading("experience")}</h3>
                        <ul className="space-y-4">
                            {items.map((exp) => (
                                <li key={exp.id} className="space-y-1">
                                    {exp.role?.trim() ? (
                                        <p className="text-sm font-semibold text-foreground">{exp.role.trim()}</p>
                                    ) : null}
                                    {exp.company?.trim() ? (
                                        <p className="text-sm text-muted-foreground">{exp.company.trim()}</p>
                                    ) : null}
                                    {exp.dates?.trim() ? (
                                        <p className="text-xs text-muted-foreground">{exp.dates.trim()}</p>
                                    ) : null}
                                    {exp.description?.trim() ? (
                                        <ul className="list-disc pl-5 text-sm text-foreground space-y-0.5">
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
                    <section key="projects" className="space-y-4">
                        <h3 className="text-sm font-semibold text-foreground">{heading("projects")}</h3>
                        <ul className="space-y-4">
                            {items.map((proj) => (
                                <li key={proj.id} className="space-y-1">
                                    {proj.role?.trim() ? (
                                        <p className="text-sm font-semibold text-foreground">{proj.role.trim()}</p>
                                    ) : null}
                                    {proj.company?.trim() ? (
                                        <p className="text-sm text-muted-foreground">{proj.company.trim()}</p>
                                    ) : null}
                                    {proj.dates?.trim() ? (
                                        <p className="text-xs text-muted-foreground">{proj.dates.trim()}</p>
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
                const categories = data.competencies ?? [];
                if (categories.length === 0) return null;
                return (
                    <section key="skills" className="space-y-2">
                        <h3 className="text-sm font-semibold text-foreground">{heading("skills")}</h3>
                        <div className="space-y-2 text-sm text-foreground">
                            {categories.map((cat, index) => (
                                <div key={cat.category || index}>
                                    {cat.category.trim() ? (
                                        <p>
                                            <span className="font-medium">{cat.category.trim()}: </span>
                                            {cat.skills.join(", ")}
                                        </p>
                                    ) : (
                                        <p>{cat.skills.join(", ")}</p>
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
                    <section key="education" className="space-y-4">
                        <h3 className="text-sm font-semibold text-foreground">{heading("education")}</h3>
                        <ul className="space-y-4">
                            {items.map((raw) => {
                                const edu = educationForDisplay(raw);
                                if (!edu.degree && !edu.institution) return null;
                                return (
                                    <li key={raw.id} className="space-y-0.5">
                                        {edu.degree ? (
                                            <p className="text-sm font-semibold text-foreground">{edu.degree}</p>
                                        ) : null}
                                        {edu.institution ? (
                                            <p className="text-sm text-muted-foreground">{edu.institution}</p>
                                        ) : null}
                                        {edu.year ? (
                                            <p className="text-xs text-muted-foreground">{edu.year}</p>
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

    return (
        <div
            data-testid="guest-resume-readout"
            className={cn(
                "w-full rounded-panel border border-border bg-surface-2 px-4 py-5 text-foreground shadow-[var(--shadow-bevel-inset)]",
                className,
            )}
        >
            {profile.name?.trim() ? (
                <h2 className="text-lg font-semibold text-foreground">{profile.name.trim()}</h2>
            ) : null}
            {contactFacts.length > 0 ? (
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {contactFacts.map(({ label, value }) => (
                        <div key={label}>
                            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                            <dd className="text-sm text-foreground break-words">{value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            <div className="mt-6 space-y-6">{sectionOrder.map((section) => renderSection(section))}</div>
        </div>
    );
}
