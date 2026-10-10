"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfidenceBadge } from "./ConfidenceIndicator";
import { scoreLocalParseConfidence } from "@/lib/local-ai/parse-confidence";
import { LEVEL_LABEL, rankingLevel } from "@/lib/resume/ranking-level";
import type { AgentPreferences } from "@/lib/agent/preferences";
import type {
    ResumeData,
    ResumeEducation,
    ResumeExperience,
} from "@/types/resume";

/** Profile fields in display order; each input is named by its label. */
const PROFILE_FIELDS = [
    { field: "name", label: "Name" },
    { field: "profession", label: "Job title" },
    { field: "yearsOfExperience", label: "Years of experience in total" },
    { field: "location", label: "Location" },
    { field: "email", label: "Email" },
    { field: "phone", label: "Phone" },
    { field: "linkedin", label: "LinkedIn" },
] as const satisfies ReadonlyArray<{ field: keyof ResumeData["profile"]; label: string }>;

/**
 * THE résumé-review form. Every place a parsed résumé is shown for correction
 * (the /jobs and /resume import dialog, first-run onboarding) renders this one
 * component, so the field set, labels and edit behaviour cannot drift between
 * entry points. Controlled: the caller owns `data` and any scrolling shell.
 */
export function ResumeReviewFields({
    data: editedData,
    onChange: setEditedData,
    agentPreferences,
}: {
    data: ResumeData;
    onChange: (next: ResumeData) => void;
    /** The signed-in person's saved preferences: Settings' Experience level comes before the résumé's. */
    agentPreferences?: AgentPreferences | null;
}) {
    const idBase = useId();
    const reviewConfidence = scoreLocalParseConfidence(editedData);
    // The level every fit label compares roles against, and the roles it was counted from.
    const level = useMemo(() => rankingLevel(editedData, agentPreferences), [editedData, agentPreferences]);
    const updateProfile = (field: keyof ResumeData["profile"], value: string | number) => {
        setEditedData({ ...editedData, profile: { ...editedData.profile, [field]: value } });
    };

    const updateExperience = (index: number, field: keyof ResumeExperience, value: string) => {
        const newExp = [...editedData.experience];
        newExp[index] = { ...newExp[index], [field]: value };
        setEditedData({ ...editedData, experience: newExp });
    };

    const updateCompetency = (index: number, skills: string[]) => {
        const newComp = [...editedData.competencies];
        newComp[index] = { ...newComp[index], skills };
        setEditedData({ ...editedData, competencies: newComp });
    };

    const updateEducation = (index: number, field: keyof ResumeEducation, value: string) => {
        const newEdu = [...editedData.education];
        newEdu[index] = { ...newEdu[index], [field]: value };
        setEditedData({ ...editedData, education: newEdu });
    };

    return (
        <div className="space-y-6">
            {/* Profile Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Profile
                        <ConfidenceBadge score={reviewConfidence.profile} section="Profile" />
                    </h4>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {PROFILE_FIELDS.map(({ field, label }) => (
                        <div key={field} className="space-y-2">
                            <Label htmlFor={`${idBase}-${field}`} className="text-xs">{label}</Label>
                            <Input
                                id={`${idBase}-${field}`}
                                type={field === "yearsOfExperience" ? "number" : undefined}
                                value={editedData.profile[field] ?? ""}
                                onChange={(e) =>
                                    updateProfile(field, field === "yearsOfExperience" ? parseInt(e.target.value) || 0 : e.target.value)
                                }
                                className="ctl-md text-base md:text-sm"
                            />
                        </div>
                    ))}
                </div>
                <div
                    className="space-y-1 rounded-panel bg-surface-2 p-3 shadow-[var(--shadow-bevel-inset)]"
                    data-testid="resume-review-level"
                    data-level={level.level ?? "unknown"}
                    data-from={level.from ?? "none"}
                >
                    <p className="text-sm font-semibold">
                        Level used for ranking: {level.level ? LEVEL_LABEL[level.level] : "not known yet"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {level.detail}
                        {level.from === "settings" ? (
                            <>
                                {" "}
                                <Link href="/settings?tab=prefs" target="_blank" className="underline underline-offset-2 hover:text-foreground">
                                    Change it in Settings
                                </Link>
                            </>
                        ) : null}
                    </p>
                </div>
            </div>

            {/* Experience Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Experience ({editedData.experience.length})
                        <ConfidenceBadge score={reviewConfidence.experience} section="Experience" />
                    </h4>
                </div>
                <div className="space-y-4">
                    {editedData.experience.map((exp, idx) => (
                        <div key={exp.id} className="rounded-panel p-3 bg-surface-2 space-y-2 shadow-[var(--shadow-bevel-inset)]">
                            {level.countedRoles.includes(idx) ? (
                                <p className="text-xs font-semibold text-live" data-testid="resume-review-counted">
                                    Counts toward your level
                                </p>
                            ) : null}
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    value={exp.company}
                                    onChange={(e) => updateExperience(idx, 'company', e.target.value)}
                                    placeholder="Company"
                                    className="ctl-md text-base md:text-sm"
                                />
                                <Input
                                    value={exp.role}
                                    onChange={(e) => updateExperience(idx, 'role', e.target.value)}
                                    placeholder="Role"
                                    className="ctl-md text-base md:text-sm"
                                />
                            </div>
                            <Input
                                value={exp.dates}
                                onChange={(e) => updateExperience(idx, 'dates', e.target.value)}
                                placeholder="Dates"
                                className="ctl-md text-base md:text-sm"
                            />
                            <Textarea
                                value={exp.description}
                                onChange={(e) => updateExperience(idx, 'description', e.target.value)}
                                placeholder="Description"
                                className="min-h-16 text-base md:text-xs"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Competencies Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Skills
                        <ConfidenceBadge score={reviewConfidence.competencies} section="Skills" />
                    </h4>
                </div>
                <div className="space-y-3">
                    {editedData.competencies.map((comp, idx) => (
                        <div key={idx} className="space-y-2">
                            <Label className="text-xs">{comp.category}</Label>
                            <Input
                                value={comp.skills.join(', ')}
                                onChange={(e) => updateCompetency(idx, e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                placeholder="Skills (comma separated)"
                                className="ctl-md text-base md:text-sm"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Education Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Education ({editedData.education.length})
                        <ConfidenceBadge score={reviewConfidence.education} section="Education" />
                    </h4>
                </div>
                <div className="space-y-3">
                    {editedData.education.map((edu, idx) => (
                        <div key={edu.id} className="rounded-panel p-3 bg-surface-2 space-y-2 shadow-[var(--shadow-bevel-inset)]">
                            <Input
                                value={edu.degree}
                                onChange={(e) => updateEducation(idx, 'degree', e.target.value)}
                                placeholder="Degree"
                                className="ctl-md text-base md:text-sm"
                            />
                            <div className="grid grid-cols-3 gap-2">
                                <Input
                                    value={edu.institution}
                                    onChange={(e) => updateEducation(idx, 'institution', e.target.value)}
                                    placeholder="Institution"
                                    className="ctl-md text-base md:text-sm col-span-2"
                                />
                                <Input
                                    value={edu.year || ""}
                                    onChange={(e) => updateEducation(idx, 'year', e.target.value)}
                                    placeholder="Year"
                                    className="ctl-md text-base md:text-sm"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Summary Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                        Summary
                        <ConfidenceBadge score={reviewConfidence.summary} section="Summary" />
                    </h4>
                </div>
                <Textarea
                    value={editedData.generatedSummary}
                    onChange={(e) => setEditedData({ ...editedData, generatedSummary: e.target.value })}
                    placeholder="Professional summary"
                    className="min-h-20 text-base md:text-sm"
                />
            </div>
        </div>
    );
}
