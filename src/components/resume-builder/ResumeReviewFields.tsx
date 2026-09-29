"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfidenceBadge } from "./ConfidenceIndicator";
import { scoreLocalParseConfidence } from "@/lib/local-ai/parse-confidence";
import type {
    ResumeData,
    ResumeEducation,
    ResumeExperience,
} from "@/types/resume";

/**
 * THE résumé-review form. Every place a parsed résumé is shown for correction
 * (the /jobs and /resume import dialog, first-run onboarding) renders this one
 * component, so the field set, labels and edit behaviour cannot drift between
 * entry points. Controlled: the caller owns `data` and any scrolling shell.
 */
export function ResumeReviewFields({
    data: editedData,
    onChange: setEditedData,
}: {
    data: ResumeData;
    onChange: (next: ResumeData) => void;
}) {
    const reviewConfidence = scoreLocalParseConfidence(editedData);
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
                    <div className="space-y-2">
                        <Label className="text-xs">Name</Label>
                        <Input
                            value={editedData.profile.name || ""}
                            onChange={(e) => updateProfile('name', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Job title</Label>
                        <Input
                            value={editedData.profile.profession}
                            onChange={(e) => updateProfile('profession', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Years of Experience</Label>
                        <Input
                            type="number"
                            value={editedData.profile.yearsOfExperience}
                            onChange={(e) => updateProfile('yearsOfExperience', parseInt(e.target.value) || 0)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Location</Label>
                        <Input
                            value={editedData.profile.location}
                            onChange={(e) => updateProfile('location', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Email</Label>
                        <Input
                            value={editedData.profile.email}
                            onChange={(e) => updateProfile('email', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Phone</Label>
                        <Input
                            value={editedData.profile.phone}
                            onChange={(e) => updateProfile('phone', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">LinkedIn</Label>
                        <Input
                            value={editedData.profile.linkedin || ""}
                            onChange={(e) => updateProfile('linkedin', e.target.value)}
                            className="ctl-md text-base md:text-sm"
                        />
                    </div>
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
