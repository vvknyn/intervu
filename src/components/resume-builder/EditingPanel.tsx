"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
    ResumeData,
    ResumeExperience,
    ResumeEducation,
    ResumeSection,
    getSectionOrder,
} from "@/types/resume";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Plus,
    Trash,
    ArrowUp,
    ArrowDown,
    CaretLeft,
    CaretRight,
    User,
    FileText,
    Sparkle,
    Briefcase,
    GraduationCap,
    ListNumbers,
    FolderSimple,
    X,
} from "@phosphor-icons/react";

interface EditingPanelProps {
    selectedSection: string | null;
    data: ResumeData;
    onUpdate: (updates: Partial<ResumeData>) => void;
    onNavigateSection: (section: string | null) => void;
}

const ALL_SECTIONS = ["header", "summary", "skills", "experience", "projects", "education"] as const;
type NavigableSection = (typeof ALL_SECTIONS)[number];

const SECTION_CONFIG: Record<
    NavigableSection,
    { title: string; subtitle: string; icon: React.ElementType }
> = {
    header: {
        title: "Contact & Profile",
        subtitle: "Your name, headline, and public contact information",
        icon: User,
    },
    summary: {
        title: "Professional Summary",
        subtitle: "A concise overview of your background and core strengths",
        icon: FileText,
    },
    skills: {
        title: "Core Competencies",
        subtitle: "Categorized skills and technical proficiencies",
        icon: Sparkle,
    },
    experience: {
        title: "Professional Experience",
        subtitle: "Work history, achievements, and responsibilities",
        icon: Briefcase,
    },
    projects: {
        title: "Projects",
        subtitle: "Independent, academic, or side projects worth showcasing",
        icon: FolderSimple,
    },
    education: {
        title: "Education & Credentials",
        subtitle: "Degrees, certifications, and academic background",
        icon: GraduationCap,
    },
};

/**
 * Everything the section nav bar needs from its parent, in one object so the
 * five call sites stay `<SectionHeader section="x" nav={nav} />`.
 */
type SectionNav = {
    onBack: () => void;
    prev: () => void;
    next: () => void;
    hasPrev: boolean;
    hasNext: boolean;
    index: number;
    total: number;
};

/**
 * Nav bar above the current section. Declared at module scope, NOT inside
 * `EditingPanel`: a component created during render has a new identity on every
 * render, so React tears down and rebuilds its entire subtree each time the
 * parent re-renders — DOM churn, restarted transitions, and any focus or scroll
 * position inside it lost. eslint react-hooks/static-components catches it.
 */
function SectionHeader({ section, nav }: { section: NavigableSection; nav: SectionNav }) {
    const config = SECTION_CONFIG[section];
    const Icon = config.icon;
    return (
        <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={nav.onBack}
                    className="rounded-ctl p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Back to all sections"
                >
                    <CaretLeft size={20} weight="bold" />
                </button>
                <div className="flex h-8 w-8 items-center justify-center rounded-panel border border-border bg-muted text-foreground">
                    <Icon size={18} />
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-foreground sm:text-base">
                        {config.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">{config.subtitle}</p>
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={nav.prev}
                    disabled={!nav.hasPrev}
                    className="rounded-ctl p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                    title="Previous section"
                >
                    <CaretLeft size={16} weight="bold" />
                </button>
                <span className="text-xs text-muted-foreground">
                    {nav.index + 1}/{nav.total}
                </span>
                <button
                    type="button"
                    onClick={nav.next}
                    disabled={!nav.hasNext}
                    className="rounded-ctl p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                    title="Next section"
                >
                    <CaretRight size={16} weight="bold" />
                </button>
            </div>
        </div>
    );
}

export function EditingPanel({
    selectedSection,
    data,
    onUpdate,
    onNavigateSection,
}: EditingPanelProps) {
    const [newSkillCategory, setNewSkillCategory] = useState("");
    const [newSkillInputs, setNewSkillInputs] = useState<Record<string, string>>({});
    // Uncommitted text for the comma-separated education list fields (honours,
    // coursework, activities) — keyed by `${educationId}:${field}` so an
    // in-progress "Dean's List, " doesn't get collapsed by the committed
    // array's re-join on every keystroke (same problem `newSkillInputs`
    // avoids for skills, one field per category instead of per list-field).
    const [eduListDrafts, setEduListDrafts] = useState<Record<string, string>>({});

    const currentSectionOrder = useMemo(
        () => getSectionOrder(data),
        [data.sectionOrder, data.profile?.profession, data.profile?.yearsOfExperience],
    );

    const isCustomOrder = Boolean(data.sectionOrder && data.sectionOrder.length > 0);

    const getNavigationSections = useMemo(() => {
        return ["header", ...currentSectionOrder] as NavigableSection[];
    }, [currentSectionOrder]);

    const currentSectionIndex = selectedSection
        ? getNavigationSections.indexOf(selectedSection as NavigableSection)
        : -1;
    const hasPrevSection = currentSectionIndex > 0;
    const hasNextSection =
        currentSectionIndex >= 0 && currentSectionIndex < getNavigationSections.length - 1;

    const navigateToPrev = useCallback(() => {
        if (hasPrevSection) {
            onNavigateSection(getNavigationSections[currentSectionIndex - 1]);
        }
    }, [hasPrevSection, onNavigateSection, getNavigationSections, currentSectionIndex]);

    const navigateToNext = useCallback(() => {
        if (hasNextSection) {
            onNavigateSection(getNavigationSections[currentSectionIndex + 1]);
        }
    }, [hasNextSection, onNavigateSection, getNavigationSections, currentSectionIndex]);

    const moveSection = (section: ResumeSection, direction: "up" | "down") => {
        const order = [...currentSectionOrder];
        const currentIndex = order.indexOf(section);
        if (currentIndex === -1) return;
        const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= order.length) return;
        [order[currentIndex], order[newIndex]] = [order[newIndex], order[currentIndex]];
        onUpdate({ sectionOrder: order });
    };

    const resetSectionOrder = () => {
        onUpdate({ sectionOrder: undefined });
    };

    const updateProfile = (field: string, value: string | number) => {
        onUpdate({
            profile: {
                ...data.profile,
                [field]: value,
            },
        });
    };

    // Built here rather than closed over: `SectionHeader` lives at module scope
    // (see its comment) so it can't reach these directly.
    const nav: SectionNav = {
        onBack: () => onNavigateSection(null),
        prev: navigateToPrev,
        next: navigateToNext,
        hasPrev: hasPrevSection,
        hasNext: hasNextSection,
        index: currentSectionIndex,
        total: getNavigationSections.length,
    };

    // 1. Overview when no section is selected
    if (!selectedSection) {
        return (
            <div className="h-full space-y-6 overflow-y-auto p-4 sm:p-6">
                <div>
                    <h3 className="text-xs font-semibold text-muted-foreground">
                        Resume Sections
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Click any section below or directly on the live template preview to edit.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {ALL_SECTIONS.map((sec) => {
                        const config = SECTION_CONFIG[sec];
                        const Icon = config.icon;
                        return (
                            <button
                                key={sec}
                                type="button"
                                onClick={() => onNavigateSection(sec)}
                                className="flex items-start gap-3 rounded-panel border border-border bg-card p-3.5 text-left transition-all hover:border-foreground hover:bg-muted"
                            >
                                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-panel border border-border bg-muted text-foreground">
                                    <Icon size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-foreground">
                                        {config.title}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {config.subtitle}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Section Ordering */}
                <div className="rounded-panel border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                        <div className="flex items-center gap-2">
                            <ListNumbers size={16} className="text-muted-foreground" />
                            <h4 className="text-xs font-semibold text-foreground">Section Order</h4>
                        </div>
                        {isCustomOrder && (
                            <button
                                type="button"
                                onClick={resetSectionOrder}
                                className="text-xs text-brand hover:underline"
                            >
                                Reset to Auto
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Reorder sections on your standard template:
                    </p>
                    <div className="space-y-1.5">
                        {currentSectionOrder.map((sec, idx) => (
                            <div
                                key={sec}
                                className="flex items-center justify-between rounded-ctl border border-border bg-background px-3 py-2 text-xs"
                            >
                                <span className="text-xs text-foreground">{sec}</span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => moveSection(sec, "up")}
                                        className="rounded-ctl p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                    >
                                        <ArrowUp />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={idx === currentSectionOrder.length - 1}
                                        onClick={() => moveSection(sec, "down")}
                                        className="rounded-ctl p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                    >
                                        <ArrowDown />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // 2. Profile / Header Section
    if (selectedSection === "header") {
        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="header" nav={nav} />
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Full Name</Label>
                            <Input
                                value={data.profile?.name || ""}
                                onChange={(e) => updateProfile("name", e.target.value)}
                                placeholder="e.g. Jane Doe"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Headline / Target Role</Label>
                            <Input
                                value={data.profile?.profession || ""}
                                onChange={(e) => updateProfile("profession", e.target.value)}
                                placeholder="e.g. Senior Software Engineer"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Email Address</Label>
                            <Input
                                type="email"
                                value={data.profile?.email || ""}
                                onChange={(e) => updateProfile("email", e.target.value)}
                                placeholder="jane@example.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Phone Number</Label>
                            <Input
                                type="tel"
                                value={data.profile?.phone || ""}
                                onChange={(e) => updateProfile("phone", e.target.value)}
                                placeholder="+1 (555) 012-3456"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Location</Label>
                            <Input
                                value={data.profile?.location || ""}
                                onChange={(e) => updateProfile("location", e.target.value)}
                                placeholder="San Francisco, CA"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">LinkedIn / Portfolio URL</Label>
                            <Input
                                value={data.profile?.linkedin || ""}
                                onChange={(e) => updateProfile("linkedin", e.target.value)}
                                placeholder="linkedin.com/in/janedoe"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Years of Experience</Label>
                            <Input
                                type="number"
                                min={0}
                                max={50}
                                value={data.profile?.yearsOfExperience || 0}
                                onChange={(e) =>
                                    updateProfile("yearsOfExperience", parseInt(e.target.value, 10) || 0)
                                }
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 3. Professional Summary
    if (selectedSection === "summary") {
        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="summary" nav={nav} />
                <div className="space-y-2">
                    <Label className="text-xs font-semibold">Summary Content</Label>
                    <Textarea
                        value={data.generatedSummary || ""}
                        onChange={(e) => onUpdate({ generatedSummary: e.target.value })}
                        placeholder="Write a focused 2-4 sentence executive summary of your background, core strengths, and impact..."
                        className="min-h-56 font-sans leading-relaxed"
                    />
                    <p className="text-xs text-muted-foreground">
                        Keep it clear and impactful. This section renders directly below your contact info on the template.
                    </p>
                </div>
            </div>
        );
    }

    // 4. Core Competencies
    if (selectedSection === "skills") {
        const competencies = data.competencies || [];

        const addCategory = () => {
            if (!newSkillCategory.trim()) return;
            onUpdate({
                competencies: [
                    ...competencies,
                    { category: newSkillCategory.trim(), skills: [] },
                ],
            });
            setNewSkillCategory("");
        };

        const updateCategoryName = (idx: number, category: string) => {
            const next = [...competencies];
            next[idx] = { ...next[idx], category };
            onUpdate({ competencies: next });
        };

        const removeCategory = (idx: number) => {
            onUpdate({
                competencies: competencies.filter((_, i) => i !== idx),
            });
        };

        const addSkillToCategory = (idx: number) => {
            const val = (newSkillInputs[idx] || "").trim();
            if (!val) return;
            const next = [...competencies];
            const currentSkills = next[idx].skills || [];
            const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
            next[idx] = {
                ...next[idx],
                skills: Array.from(new Set([...currentSkills, ...parts])),
            };
            onUpdate({ competencies: next });
            setNewSkillInputs((prev) => ({ ...prev, [idx]: "" }));
        };

        const removeSkillFromCategory = (catIdx: number, skillIdx: number) => {
            const next = [...competencies];
            next[catIdx] = {
                ...next[catIdx],
                skills: next[catIdx].skills.filter((_, i) => i !== skillIdx),
            };
            onUpdate({ competencies: next });
        };

        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="skills" nav={nav} />

                {/* Add new category */}
                <div className="flex gap-2">
                    <Input
                        value={newSkillCategory}
                        onChange={(e) => setNewSkillCategory(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                addCategory();
                            }
                        }}
                        placeholder="New category name (e.g. Languages, Cloud, Frameworks)..."
                    />
                    <Button
                        type="button"
                        size="sm"
                        onClick={addCategory}
                        disabled={!newSkillCategory.trim()}
                        className="gap-1 text-xs"
                    >
                        <Plus /> Add Category
                    </Button>
                </div>

                {competencies.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No competencies added yet. Create a category to organize your skills.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {competencies.map((cat, catIdx) => (
                            <div
                                key={catIdx}
                                className="rounded-panel border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <Input
                                        value={cat.category}
                                        onChange={(e) => updateCategoryName(catIdx, e.target.value)}
                                        className="h-8 font-semibold text-base md:text-xs max-w-xs"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeCategory(catIdx)}
                                        className="h-8 text-danger-text hover:text-danger-text"
                                    >
                                        <Trash />
                                    </Button>
                                </div>

                                {/* Skill Pills */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {cat.skills.map((skill, skillIdx) => (
                                        <span
                                            key={skillIdx}
                                            className="inline-flex items-center gap-1 rounded-pill border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                                        >
                                            {skill}
                                            <button
                                                type="button"
                                                onClick={() => removeSkillFromCategory(catIdx, skillIdx)}
                                                className="hover:text-danger-text"
                                            >
                                                <X />
                                            </button>
                                        </span>
                                    ))}
                                </div>

                                {/* Add skill input */}
                                <div className="flex gap-2">
                                    <Input
                                        value={newSkillInputs[catIdx] || ""}
                                        onChange={(e) =>
                                            setNewSkillInputs((prev) => ({
                                                ...prev,
                                                [catIdx]: e.target.value,
                                            }))
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                addSkillToCategory(catIdx);
                                            }
                                        }}
                                        placeholder="Add skill (press Enter)..."
                                        className="h-8"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addSkillToCategory(catIdx)}
                                        disabled={!(newSkillInputs[catIdx] || "").trim()}
                                        className="h-8 text-xs"
                                    >
                                        Add
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // 5. Professional Experience
    if (selectedSection === "experience") {
        const experience = data.experience || [];

        const addExperience = () => {
            const newExp: ResumeExperience = {
                id: `exp-${Date.now()}`,
                company: "",
                role: "",
                dates: "Jan 2024 — Present",
                description: "• Spearheaded key initiatives that drove business value\n• Led architecture and execution of core systems",
            };
            onUpdate({ experience: [newExp, ...experience] });
        };

        const updateExpField = (id: string, field: keyof ResumeExperience, value: string) => {
            onUpdate({
                experience: experience.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
            });
        };

        const removeExp = (id: string) => {
            onUpdate({
                experience: experience.filter((e) => e.id !== id),
            });
        };

        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="experience" nav={nav} />

                <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                        {experience.length} position{experience.length === 1 ? "" : "s"} listed
                    </span>
                    <Button type="button" size="sm" onClick={addExperience} className="gap-1 text-xs">
                        <Plus /> Add Position
                    </Button>
                </div>

                {experience.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No work experience listed. Add a role to get started.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {experience.map((exp, idx) => (
                            <div
                                key={exp.id || idx}
                                className="rounded-panel border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                        Role #{idx + 1}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeExp(exp.id)}
                                        className="h-7 text-danger-text hover:text-danger-text"
                                    >
                                        <Trash />
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Job Title / Role</Label>
                                        <Input
                                            value={exp.role}
                                            onChange={(e) => updateExpField(exp.id, "role", e.target.value)}
                                            placeholder="e.g. Lead Product Engineer"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Company / Organization</Label>
                                        <Input
                                            value={exp.company}
                                            onChange={(e) => updateExpField(exp.id, "company", e.target.value)}
                                            placeholder="e.g. Acme Corp"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Dates / Timeline</Label>
                                    <Input
                                        value={exp.dates}
                                        onChange={(e) => updateExpField(exp.id, "dates", e.target.value)}
                                        placeholder="e.g. Mar 2021 — Present"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Key Accomplishments & Bullets</Label>
                                    <Textarea
                                        value={exp.description}
                                        onChange={(e) => updateExpField(exp.id, "description", e.target.value)}
                                        placeholder="• Start each bullet with an action verb (Built, Led, Reduced, Scaled)..."
                                        className="min-h-32"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // 6. Projects
    if (selectedSection === "projects") {
        const projects = data.projects || [];

        const addProject = () => {
            const newProj: ResumeExperience = {
                id: `proj-${Date.now()}`,
                company: "",
                role: "",
                dates: "",
                description: "",
            };
            onUpdate({ projects: [newProj, ...projects] });
        };

        const updateProjField = (id: string, field: keyof ResumeExperience, value: string) => {
            onUpdate({
                projects: projects.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
            });
        };

        const removeProj = (id: string) => {
            onUpdate({
                projects: projects.filter((p) => p.id !== id),
            });
        };

        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="projects" nav={nav} />

                <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                        {projects.length} project{projects.length === 1 ? "" : "s"} listed
                    </span>
                    <Button type="button" size="sm" onClick={addProject} className="gap-1 text-xs">
                        <Plus /> Add Project
                    </Button>
                </div>

                {projects.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No projects listed. Add one to showcase independent or academic work.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {projects.map((proj, idx) => (
                            <div
                                key={proj.id || idx}
                                className="rounded-panel border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                        Project #{idx + 1}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeProj(proj.id)}
                                        className="h-7 text-danger-text hover:text-danger-text"
                                    >
                                        <Trash />
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Project Name</Label>
                                        <Input
                                            value={proj.role}
                                            onChange={(e) => updateProjField(proj.id, "role", e.target.value)}
                                            placeholder="e.g. Real-time Chat App"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Organization / Link (optional)</Label>
                                        <Input
                                            value={proj.company}
                                            onChange={(e) => updateProjField(proj.id, "company", e.target.value)}
                                            placeholder="e.g. github.com/you/project or Course name"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Dates (optional)</Label>
                                    <Input
                                        value={proj.dates}
                                        onChange={(e) => updateProjField(proj.id, "dates", e.target.value)}
                                        placeholder="e.g. Fall 2024"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Key Details & Bullets</Label>
                                    <Textarea
                                        value={proj.description}
                                        onChange={(e) => updateProjField(proj.id, "description", e.target.value)}
                                        placeholder="• Start each bullet with an action verb (Built, Led, Reduced, Scaled)..."
                                        className="min-h-32"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // 7. Education
    if (selectedSection === "education") {
        const education = data.education || [];

        const addEducation = () => {
            const newEdu: ResumeEducation = {
                id: `edu-${Date.now()}`,
                degree: "",
                institution: "",
                year: "2022",
            };
            onUpdate({ education: [...education, newEdu] });
        };

        const updateEduField = (id: string, field: "degree" | "institution" | "year" | "gpa", value: string) => {
            onUpdate({
                education: education.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
            });
        };

        const eduListDraftKey = (id: string, field: "honours" | "coursework" | "activities") => `${id}:${field}`;

        const commitEduListField = (id: string, field: "honours" | "coursework" | "activities", raw: string) => {
            const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate({
                education: education.map((e) => (e.id === id ? { ...e, [field]: list } : e)),
            });
            setEduListDrafts((prev) => {
                const next = { ...prev };
                delete next[eduListDraftKey(id, field)];
                return next;
            });
        };

        const removeEdu = (id: string) => {
            onUpdate({
                education: education.filter((e) => e.id !== id),
            });
        };

        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="education" nav={nav} />

                <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                        {education.length} credential{education.length === 1 ? "" : "s"} listed
                    </span>
                    <Button type="button" size="sm" onClick={addEducation} className="gap-1 text-xs">
                        <Plus /> Add Education
                    </Button>
                </div>

                {education.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No education records listed yet.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {education.map((edu, idx) => (
                            <div
                                key={edu.id || idx}
                                className="rounded-panel border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                        Record #{idx + 1}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeEdu(edu.id)}
                                        className="h-7 text-danger-text hover:text-danger-text"
                                    >
                                        <Trash />
                                    </Button>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Degree / Certification</Label>
                                    <Input
                                        value={edu.degree}
                                        onChange={(e) => updateEduField(edu.id, "degree", e.target.value)}
                                        placeholder="e.g. B.S. in Computer Science"
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Institution / University</Label>
                                        <Input
                                            value={edu.institution}
                                            onChange={(e) => updateEduField(edu.id, "institution", e.target.value)}
                                            placeholder="e.g. University of California, Berkeley"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Year of Completion</Label>
                                        <Input
                                            value={edu.year || ""}
                                            onChange={(e) => updateEduField(edu.id, "year", e.target.value)}
                                            placeholder="e.g. 2022"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">GPA</Label>
                                        <Input
                                            value={edu.gpa || ""}
                                            onChange={(e) => updateEduField(edu.id, "gpa", e.target.value)}
                                            placeholder="e.g. 3.8 / 4.0"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Honours</Label>
                                        <Input
                                            value={
                                                eduListDrafts[eduListDraftKey(edu.id, "honours")] ??
                                                (edu.honours || []).join(", ")
                                            }
                                            onChange={(e) =>
                                                setEduListDrafts((prev) => ({
                                                    ...prev,
                                                    [eduListDraftKey(edu.id, "honours")]: e.target.value,
                                                }))
                                            }
                                            onBlur={(e) => commitEduListField(edu.id, "honours", e.target.value)}
                                            placeholder="e.g. Dean's List, Magna Cum Laude"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Relevant coursework</Label>
                                    <Input
                                        value={
                                            eduListDrafts[eduListDraftKey(edu.id, "coursework")] ??
                                            (edu.coursework || []).join(", ")
                                        }
                                        onChange={(e) =>
                                            setEduListDrafts((prev) => ({
                                                ...prev,
                                                [eduListDraftKey(edu.id, "coursework")]: e.target.value,
                                            }))
                                        }
                                        onBlur={(e) => commitEduListField(edu.id, "coursework", e.target.value)}
                                        placeholder="e.g. Data Structures, Distributed Systems, Linear Algebra"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Activities</Label>
                                    <Input
                                        value={
                                            eduListDrafts[eduListDraftKey(edu.id, "activities")] ??
                                            (edu.activities || []).join(", ")
                                        }
                                        onChange={(e) =>
                                            setEduListDrafts((prev) => ({
                                                ...prev,
                                                [eduListDraftKey(edu.id, "activities")]: e.target.value,
                                            }))
                                        }
                                        onBlur={(e) => commitEduListField(edu.id, "activities", e.target.value)}
                                        placeholder="e.g. Robotics Club, Varsity Soccer, Hackathon Organizer"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return null;
}
