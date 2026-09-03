"use client";

import React, { useState, useMemo } from "react";
import { ResumeData, ResumeSection, detectProfessionType, getSectionOrder } from "@/types/resume";
import { PencilSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface LiveResumePreviewProps {
    data: ResumeData;
    onEdit?: (section: string) => void;
    selectedSection?: string | null;
    originalData?: ResumeData | null;
    showDiffs?: boolean;
    printMode?: boolean;
    className?: string;
}

/**
 * The ambient state every previewed section needs. Passed as one object so the
 * five call sites don't each thread five props.
 */
type PreviewCtx = {
    selectedSection?: string | null;
    hoveredSection: string | null;
    setHoveredSection: (id: string | null) => void;
    printMode: boolean;
    onEdit?: (section: string) => void;
};

/**
 * Click/hover affordance around one resume section. Declared at module scope,
 * NOT inside `LiveResumePreview`: a component created during render has a new
 * identity every render, so React tears down and rebuilds `children` — the
 * whole rendered résumé — on each parent re-render. eslint
 * react-hooks/static-components catches it.
 */
function SectionWrapper({
    id,
    children,
    className: wrapperClass = "",
    changeStatus = null,
    ctx,
}: {
    id: string;
    children: React.ReactNode;
    className?: string;
    changeStatus?: "modified" | "new" | "removed" | null;
    ctx: PreviewCtx;
}) {
    const isSelected = ctx.selectedSection === id;
    const isHovered = ctx.hoveredSection === id;

    if (ctx.printMode || !ctx.onEdit) {
        return <div className={cn("relative", wrapperClass)}>{children}</div>;
    }

    const diffBadge =
        changeStatus === "modified" ? (
            <span className="absolute -top-1 -right-1 rounded-none bg-warn text-white px-1 py-0.5 text-xs font-semibold">
                Diff
            </span>
        ) : changeStatus === "new" ? (
            <span className="absolute -top-1 -right-1 rounded-none bg-live text-white px-1 py-0.5 text-xs font-semibold">
                New
            </span>
        ) : null;

    return (
        <div
            className={cn(
                "relative group cursor-pointer transition-all duration-150 rounded-none p-1 -m-1",
                isSelected
                    ? "ring-2 ring-live bg-muted dark:bg-muted"
                    : isHovered
                        ? "ring-1 ring-placeholder-text bg-muted dark:bg-border"
                        : changeStatus === "modified"
                            ? "bg-muted ring-1 ring-warn"
                            : changeStatus === "new"
                                ? "bg-muted ring-1 ring-live"
                                : "",
                wrapperClass,
            )}
            onMouseEnter={() => ctx.setHoveredSection(id)}
            onMouseLeave={() => ctx.setHoveredSection(null)}
            onClick={() => ctx.onEdit?.(id)}
        >
            {diffBadge}
            {children}
            {isHovered && !isSelected && (
                <span className="absolute top-1 right-1 flex items-center gap-1 rounded-none bg-foreground text-white px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <PencilSimple size={10} /> Edit
                </span>
            )}
        </div>
    );
}

export function LiveResumePreview({
    data,
    onEdit,
    selectedSection,
    originalData,
    showDiffs = true,
    printMode = false,
    className,
}: LiveResumePreviewProps) {
    const [hoveredSection, setHoveredSection] = useState<string | null>(null);

    // Section ordering (custom or auto-detected)
    const sectionOrder = useMemo(() => {
        if (data.sectionOrder && data.sectionOrder.length > 0) {
            return data.sectionOrder;
        }
        const professionType = detectProfessionType(data.profile?.profession || "");
        return getSectionOrder(data.profile?.yearsOfExperience || 0, professionType);
    }, [data.sectionOrder, data.profile?.profession, data.profile?.yearsOfExperience]);

    // Diff calculation helpers
    const getChangeStatus = (section: string, itemId?: string): "modified" | "new" | "removed" | null => {
        if (!originalData || !showDiffs || printMode) return null;

        if (section === "header") {
            const p1 = data.profile || {};
            const p2 = originalData.profile || {};
            const changed =
                p1.name !== p2.name ||
                p1.profession !== p2.profession ||
                p1.email !== p2.email ||
                p1.phone !== p2.phone ||
                p1.location !== p2.location ||
                p1.linkedin !== p2.linkedin;
            return changed ? "modified" : null;
        }

        if (section === "summary") {
            const s1 = (data.generatedSummary || "").trim();
            const s2 = (originalData.generatedSummary || "").trim();
            return s1 !== s2 ? "modified" : null;
        }

        if (section === "skills") {
            const c1 = JSON.stringify(data.competencies || []);
            const c2 = JSON.stringify(originalData.competencies || []);
            return c1 !== c2 ? "modified" : null;
        }

        if (section === "experience" && itemId) {
            const currentExp = data.experience?.find((e) => e.id === itemId);
            const origExp = originalData.experience?.find((e) => e.id === itemId);
            if (!origExp) return "new";
            if (!currentExp) return "removed";
            const clean = (s?: string) => (s || "").trim().replace(/\s+/g, " ");
            const changed =
                clean(currentExp.role) !== clean(origExp.role) ||
                clean(currentExp.company) !== clean(origExp.company) ||
                clean(currentExp.dates) !== clean(origExp.dates) ||
                clean(currentExp.description) !== clean(origExp.description);
            return changed ? "modified" : null;
        }

        if (section === "education" && itemId) {
            const currentEdu = data.education?.find((e) => e.id === itemId);
            const origEdu = originalData.education?.find((e) => e.id === itemId);
            if (!origEdu) return "new";
            if (!currentEdu) return "removed";
            const clean = (s?: string) => (s || "").trim().replace(/\s+/g, " ");
            const changed =
                clean(currentEdu.degree) !== clean(origEdu.degree) ||
                clean(currentEdu.institution) !== clean(origEdu.institution) ||
                clean(currentEdu.year) !== clean(origEdu.year);
            return changed ? "modified" : null;
        }

        return null;
    };

    const removedExperiences = useMemo(() => {
        if (!originalData || !showDiffs || printMode) return [];
        return (originalData.experience || []).filter(
            (orig) => !data.experience?.some((curr) => curr.id === orig.id),
        );
    }, [data.experience, originalData, showDiffs, printMode]);

    const removedEducations = useMemo(() => {
        if (!originalData || !showDiffs || printMode) return [];
        return (originalData.education || []).filter(
            (orig) => !data.education?.some((curr) => curr.id === orig.id),
        );
    }, [data.education, originalData, showDiffs, printMode]);

    // Gathered here because `SectionWrapper` sits at module scope (see its
    // comment) and can no longer close over these.
    const ctx: PreviewCtx = { selectedSection, hoveredSection, setHoveredSection, printMode, onEdit };

    const renderSummary = () => {
        if (!data.generatedSummary && !onEdit) return null;
        const changeStatus = getChangeStatus("summary");
        return (
            <SectionWrapper id="summary" className="mb-2.5" changeStatus={changeStatus} ctx={ctx}>
                <h2 className="text-xs font-semibold text-center border-b border-foreground pb-0.5 mb-1">
                    Professional Summary
                </h2>
                {data.generatedSummary ? (
                    <p className="text-xs leading-relaxed text-justify text-foreground dark:text-muted-foreground whitespace-pre-line">
                        {data.generatedSummary}
                    </p>
                ) : (
                    <p className="text-placeholder-text italic text-xs text-center py-1">
                        Click to add professional summary
                    </p>
                )}
            </SectionWrapper>
        );
    };

    const renderSkills = () => {
        const hasSkills = data.competencies && data.competencies.length > 0;
        if (!hasSkills && !onEdit) return null;
        const changeStatus = getChangeStatus("skills");
        return (
            <SectionWrapper id="skills" className="mb-2.5" changeStatus={changeStatus} ctx={ctx}>
                <h2 className="text-xs font-semibold text-center border-b border-foreground pb-0.5 mb-1">
                    Core Competencies
                </h2>
                {hasSkills ? (
                    <div className="space-y-0.5 text-xs leading-snug text-foreground dark:text-muted-foreground">
                        {data.competencies.map((comp, index) => (
                            <div key={comp.category || index}>
                                <span className="font-semibold">{comp.category}: </span>
                                <span>{comp.skills.join(", ")}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-placeholder-text italic text-xs text-center py-1">
                        Click to add core competencies & skills
                    </p>
                )}
            </SectionWrapper>
        );
    };

    const renderExperience = () => {
        const hasExp = data.experience && data.experience.length > 0;
        if (!hasExp && !onEdit && removedExperiences.length === 0) return null;
        return (
            <SectionWrapper id="experience" className="mb-2.5" ctx={ctx}>
                <h2 className="text-xs font-semibold text-center border-b border-foreground pb-0.5 mb-1">
                    Professional Experience
                </h2>
                {hasExp || removedExperiences.length > 0 ? (
                    <div className="space-y-2 text-foreground dark:text-muted-foreground">
                        {data.experience.map((exp, index) => {
                            const itemStatus = getChangeStatus("experience", exp.id);
                            return (
                                <div
                                    key={exp.id || index}
                                    className={cn(
                                        "space-y-0.5 relative transition-colors rounded-none",
                                        itemStatus === "modified" &&
                                            "bg-muted border-l-2 border-warn pl-1 -ml-1",
                                        itemStatus === "new" &&
                                            "bg-muted border-l-2 border-live pl-1 -ml-1",
                                    )}
                                >
                                    <div className="flex justify-between items-baseline text-xs">
                                        <div>
                                            <span className="font-semibold">{exp.role || "Job Title"}</span>
                                            {exp.company && (
                                                <>
                                                    <span className="mx-1 text-placeholder-text">|</span>
                                                    <span className="">{exp.company}</span>
                                                </>
                                            )}
                                            {itemStatus === "modified" && (
                                                <span className="ml-1.5 text-xs text-warn bg-muted px-1 py-0.5 rounded-none font-semibold">
                                                    Edited
                                                </span>
                                            )}
                                            {itemStatus === "new" && (
                                                <span className="ml-1.5 text-xs text-live bg-muted px-1 py-0.5 rounded-none font-semibold">
                                                    New
                                                </span>
                                            )}
                                        </div>
                                        {exp.dates && (
                                            <span className="text-xs italic text-muted-foreground dark:text-border whitespace-nowrap ml-2">
                                                {exp.dates}
                                            </span>
                                        )}
                                    </div>
                                    {exp.description && (
                                        <ul className="text-xs space-y-0.5 pl-0">
                                            {exp.description
                                                .split("\n")
                                                .filter((line) => line.trim())
                                                .map((line, i) => (
                                                    <li key={i} className="flex leading-snug">
                                                        <span className="mr-1.5 text-muted-foreground shrink-0">•</span>
                                                        <span className="text-justify">{line.replace(/^[•\-\*]\s*/, "")}</span>
                                                    </li>
                                                ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}

                        {/* Render Removed Experiences when comparing */}
                        {removedExperiences.map((exp, index) => (
                            <div
                                key={`removed-${exp.id || index}`}
                                className="space-y-0.5 opacity-50 bg-muted border-l-2 border-danger-text pl-1 -ml-1 line-through"
                            >
                                <div className="flex justify-between items-baseline text-xs">
                                    <div>
                                        <span className="font-semibold">{exp.role || "Job Title"}</span>
                                        <span className="mx-1">|</span>
                                        <span>{exp.company || "Company"}</span>
                                        <span className="ml-1.5 text-xs text-danger-text bg-muted px-1 py-0.5 rounded-none font-semibold not-italic no-underline inline-block">
                                            Removed
                                        </span>
                                    </div>
                                    <span className="text-xs italic whitespace-nowrap ml-2">
                                        {exp.dates}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-placeholder-text italic text-xs text-center py-1">
                        Click to add professional experience
                    </p>
                )}
            </SectionWrapper>
        );
    };

    const renderEducation = () => {
        const hasEdu = data.education && data.education.length > 0;
        if (!hasEdu && !onEdit && removedEducations.length === 0) return null;
        return (
            <SectionWrapper id="education" className="mb-2.5" ctx={ctx}>
                <h2 className="text-xs font-semibold text-center border-b border-foreground pb-0.5 mb-1">
                    Education & Professional Development
                </h2>
                {hasEdu || removedEducations.length > 0 ? (
                    <div className="space-y-1 text-xs text-foreground dark:text-muted-foreground">
                        {data.education.map((edu, index) => {
                            const itemStatus = getChangeStatus("education", edu.id);
                            return (
                                <div
                                    key={edu.id || index}
                                    className={cn(
                                        "flex justify-between items-baseline leading-snug rounded-none",
                                        itemStatus === "modified" &&
                                            "bg-muted border-l-2 border-warn pl-1 -ml-1",
                                        itemStatus === "new" &&
                                            "bg-muted border-l-2 border-live pl-1 -ml-1",
                                    )}
                                >
                                    <div>
                                        <span className="font-semibold">{edu.degree}</span>
                                        {edu.institution && <span className="text-muted-foreground"> | {edu.institution}</span>}
                                        {itemStatus === "modified" && (
                                            <span className="ml-1.5 text-xs text-warn bg-muted px-1 py-0.5 rounded-none font-semibold">
                                                Edited
                                            </span>
                                        )}
                                        {itemStatus === "new" && (
                                            <span className="ml-1.5 text-xs text-live bg-muted px-1 py-0.5 rounded-none font-semibold">
                                                New
                                            </span>
                                        )}
                                    </div>
                                    {edu.year && <span className="text-xs italic text-muted-foreground">({edu.year})</span>}
                                </div>
                            );
                        })}

                        {removedEducations.map((edu, index) => (
                            <div
                                key={`removed-edu-${edu.id || index}`}
                                className="flex justify-between items-baseline leading-snug opacity-50 bg-muted border-l-2 border-danger-text pl-1 -ml-1 line-through"
                            >
                                <div>
                                    <span className="font-semibold">{edu.degree}</span>
                                    {edu.institution && <span> | {edu.institution}</span>}
                                    <span className="ml-1.5 text-xs text-danger-text bg-muted px-1 py-0.5 rounded-none font-semibold not-italic no-underline inline-block">
                                        Removed
                                    </span>
                                </div>
                                {edu.year && <span className="text-xs italic">({edu.year})</span>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-placeholder-text italic text-xs text-center py-1">
                        Click to add education & credentials
                    </p>
                )}
            </SectionWrapper>
        );
    };

    const sectionComponents: Record<ResumeSection, () => React.ReactNode> = {
        summary: renderSummary,
        skills: renderSkills,
        experience: renderExperience,
        education: renderEducation,
        projects: () => null,
    };

    const contactItems = [
        data.profile?.location,
        data.profile?.phone,
        data.profile?.email,
        data.profile?.linkedin?.replace(/^https?:\/\/(www\.)?/, ""),
    ].filter(Boolean);

    const headerChangeStatus = getChangeStatus("header");

    return (
        <div
            className={cn(
                printMode
                    ? "bg-white text-foreground w-full"
                    : "bg-white text-foreground border border-border dark:border-border rounded-none w-full max-w-[8.5in] mx-auto",
                className,
            )}
            style={{ fontFamily: "'Times New Roman', Times, Georgia, serif" }}
        >
            <div className={printMode ? "px-6 py-4 text-foreground" : "px-7 py-6 min-h-[10.5in] text-foreground"}>
                {/* Header Section */}
                <SectionWrapper id="header" className="text-center pb-2 mb-2.5 border-b border-foreground" changeStatus={headerChangeStatus} ctx={ctx}>
                    <h1 className="text-lg font-semibold text-foreground mb-0.5">
                        {data.profile?.name || "Your Name"}
                    </h1>
                    {data.profile?.profession && (
                        <div className="text-xs font-semibold text-foreground mb-1">
                            {data.profile.profession}
                        </div>
                    )}
                    <div className="text-xs text-foreground flex flex-wrap items-center justify-center gap-x-1.5">
                        {contactItems.length > 0 ? (
                            contactItems.map((item, idx) => (
                                <React.Fragment key={idx}>
                                    {idx > 0 && <span className="text-placeholder-text">|</span>}
                                    <span>{item}</span>
                                </React.Fragment>
                            ))
                        ) : (
                            <span className="text-placeholder-text italic">Click to add contact details</span>
                        )}
                    </div>
                </SectionWrapper>

                {/* Body Sections */}
                {sectionOrder.map((section) => (
                    <React.Fragment key={section}>
                        {sectionComponents[section]?.()}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
}
