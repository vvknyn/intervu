"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
    ResumeData,
    ResumeExperience,
    ResumeCompetencyCategory,
    ResumeEducation,
    ResumeSection,
    detectProfessionType,
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
    X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface EditingPanelProps {
    selectedSection: string | null;
    data: ResumeData;
    onUpdate: (updates: Partial<ResumeData>) => void;
    onNavigateSection: (section: string | null) => void;
}

const ALL_SECTIONS = ["header", "summary", "skills", "experience", "education"] as const;
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
    education: {
        title: "Education & Credentials",
        subtitle: "Degrees, certifications, and academic background",
        icon: GraduationCap,
    },
};

export function EditingPanel({
    selectedSection,
    data,
    onUpdate,
    onNavigateSection,
}: EditingPanelProps) {
    const [newSkillCategory, setNewSkillCategory] = useState("");
    const [newSkillInputs, setNewSkillInputs] = useState<Record<string, string>>({});

    const currentSectionOrder = useMemo(() => {
        if (data.sectionOrder && data.sectionOrder.length > 0) {
            return data.sectionOrder;
        }
        const professionType = detectProfessionType(data.profile?.profession || "");
        return getSectionOrder(data.profile?.yearsOfExperience || 0, professionType);
    }, [data.sectionOrder, data.profile?.profession, data.profile?.yearsOfExperience]);

    const isCustomOrder = Boolean(data.sectionOrder && data.sectionOrder.length > 0);

    const getNavigationSections = useMemo(() => {
        return [
            "header",
            ...currentSectionOrder.filter((s) => s !== "projects"),
        ] as NavigableSection[];
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

    // Header / Nav bar above current section
    const SectionHeader = ({ section }: { section: NavigableSection }) => {
        const config = SECTION_CONFIG[section];
        const Icon = config.icon;
        return (
            <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => onNavigateSection(null)}
                        className="rounded-none p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Back to all sections"
                    >
                        <CaretLeft size={20} weight="bold" />
                    </button>
                    <div className="flex h-8 w-8 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground">
                        <Icon size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-tight text-foreground sm:text-base">
                            {config.title}
                        </h2>
                        <p className="text-xs text-muted-foreground">{config.subtitle}</p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={navigateToPrev}
                        disabled={!hasPrevSection}
                        className="rounded-none p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                        title="Previous section"
                    >
                        <CaretLeft size={16} weight="bold" />
                    </button>
                    <span className="font-mono text-xs text-muted-foreground">
                        {currentSectionIndex + 1}/{getNavigationSections.length}
                    </span>
                    <button
                        type="button"
                        onClick={navigateToNext}
                        disabled={!hasNextSection}
                        className="rounded-none p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                        title="Next section"
                    >
                        <CaretRight size={16} weight="bold" />
                    </button>
                </div>
            </div>
        );
    };

    // 1. Overview when no section is selected
    if (!selectedSection) {
        return (
            <div className="h-full space-y-6 overflow-y-auto p-4 sm:p-6">
                <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
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
                                className="flex items-start gap-3 rounded-none border border-border bg-card p-3.5 text-left transition-all hover:border-foreground hover:bg-muted/20"
                            >
                                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground">
                                    <Icon size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-bold uppercase tracking-tight text-foreground">
                                        {config.title}
                                    </div>
                                    <div className="truncate text-[11px] text-muted-foreground">
                                        {config.subtitle}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Section Ordering */}
                <div className="rounded-none border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                        <div className="flex items-center gap-2">
                            <ListNumbers size={16} className="text-muted-foreground" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Section Order</h4>
                        </div>
                        {isCustomOrder && (
                            <button
                                type="button"
                                onClick={resetSectionOrder}
                                className="font-mono text-xs text-brand hover:underline"
                            >
                                Reset to Auto
                            </button>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Reorder sections on your standard template:
                    </p>
                    <div className="space-y-1.5">
                        {currentSectionOrder.map((sec, idx) => (
                            <div
                                key={sec}
                                className="flex items-center justify-between rounded-none border border-border bg-background/50 px-3 py-2 text-xs"
                            >
                                <span className="font-mono text-xs uppercase text-foreground">{sec}</span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => moveSection(sec, "up")}
                                        className="rounded-none p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                    >
                                        <ArrowUp size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={idx === currentSectionOrder.length - 1}
                                        onClick={() => moveSection(sec, "down")}
                                        className="rounded-none p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                    >
                                        <ArrowDown size={13} />
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
                <SectionHeader section="header" />
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
                <SectionHeader section="summary" />
                <div className="space-y-2">
                    <Label className="text-xs font-semibold">Summary Content</Label>
                    <Textarea
                        value={data.generatedSummary || ""}
                        onChange={(e) => onUpdate({ generatedSummary: e.target.value })}
                        placeholder="Write a focused 2-4 sentence executive summary of your background, core strengths, and impact..."
                        className="min-h-[220px] font-sans leading-relaxed"
                    />
                    <p className="text-[11px] text-muted-foreground">
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
                <SectionHeader section="skills" />

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
                        <Plus size={14} /> Add Category
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
                                className="rounded-none border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <Input
                                        value={cat.category}
                                        onChange={(e) => updateCategoryName(catIdx, e.target.value)}
                                        className="h-8 font-semibold text-xs max-w-xs"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeCategory(catIdx)}
                                        className="h-8 text-destructive hover:text-destructive"
                                    >
                                        <Trash size={14} />
                                    </Button>
                                </div>

                                {/* Skill Pills */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {cat.skills.map((skill, skillIdx) => (
                                        <span
                                            key={skillIdx}
                                            className="inline-flex items-center gap-1 rounded-none border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-medium text-foreground"
                                        >
                                            {skill}
                                            <button
                                                type="button"
                                                onClick={() => removeSkillFromCategory(catIdx, skillIdx)}
                                                className="hover:text-destructive"
                                            >
                                                <X size={10} />
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
                <SectionHeader section="experience" />

                <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-muted-foreground">
                        {experience.length} position{experience.length === 1 ? "" : "s"} listed
                    </span>
                    <Button type="button" size="sm" onClick={addExperience} className="gap-1 text-xs">
                        <Plus size={14} /> Add Position
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
                                className="rounded-none border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        Role #{idx + 1}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeExp(exp.id)}
                                        className="h-7 text-destructive hover:text-destructive"
                                    >
                                        <Trash size={14} />
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
                                        className="min-h-[120px] font-mono"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // 6. Education
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

        const updateEduField = (id: string, field: keyof ResumeEducation, value: string) => {
            onUpdate({
                education: education.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
            });
        };

        const removeEdu = (id: string) => {
            onUpdate({
                education: education.filter((e) => e.id !== id),
            });
        };

        return (
            <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
                <SectionHeader section="education" />

                <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-muted-foreground">
                        {education.length} credential{education.length === 1 ? "" : "s"} listed
                    </span>
                    <Button type="button" size="sm" onClick={addEducation} className="gap-1 text-xs">
                        <Plus size={14} /> Add Education
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
                                className="rounded-none border border-border bg-card p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        Record #{idx + 1}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeEdu(edu.id)}
                                        className="h-7 text-destructive hover:text-destructive"
                                    >
                                        <Trash size={14} />
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
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return null;
}
