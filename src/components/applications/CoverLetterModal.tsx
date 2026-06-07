"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Application, updateApplication } from "@/actions/application";
import { CoverLetterSection } from "./CoverLetterSection";
import { fetchTailoredVersions } from "@/actions/tailor-resume";
import { fetchResumeData } from "@/actions/resume";
import { toast } from "@/lib/toast";

interface CoverLetterModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    application: Application;
    onSuccess: () => void;
}

export function CoverLetterModal({ open, onOpenChange, application, onSuccess }: CoverLetterModalProps) {
    const [resumeContent, setResumeContent] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (open) {
            loadResumeContent();
        }
    }, [open, application.resume_version_id]);

    const loadResumeContent = async () => {
        setIsLoading(true);
        try {
            // Strategy: 
            // 1. Try to find the specific tailored version
            // 2. If not found or no version ID, fallback to base resume

            let contentString = "";
            let foundVersion = false;

            if (application.resume_version_id) {
                const { data: versions } = await fetchTailoredVersions();
                const version = versions?.find(v => v.id === application.resume_version_id);

                if (version) {
                    contentString = `
                        SUMMARY: ${version.tailoredSummary}
                        EXPERIENCE: ${JSON.stringify(version.tailoredExperience)}
                        COMPETENCIES: ${JSON.stringify(version.tailoredCompetencies)}
                        EDUCATION: ${JSON.stringify(version.originalEducation)}
                    `;
                    foundVersion = true;
                }
            }

            if (!foundVersion) {
                // Fallback to base resume
                const { data: baseData } = await fetchResumeData();
                if (baseData) {
                    contentString = `
                        SUMMARY: ${baseData.generatedSummary}
                        EXPERIENCE: ${JSON.stringify(baseData.experience)}
                        COMPETENCIES: ${JSON.stringify(baseData.competencies)}
                        EDUCATION: ${JSON.stringify(baseData.education)}
                    `;
                }
            }

            setResumeContent(contentString);
        } catch (e) {
            console.error("Failed to load resume content for cover letter", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async (content: string) => {
        try {
            const result = await updateApplication(application.id, { cover_letter: content });
            if (result?.error) {
                // updateApplication returns { error } on failure — previously ignored,
                // so a failed save looked successful to the user.
                toast.error(`Could not save cover letter: ${result.error}`);
                return;
            }
            onSuccess();
            // Modal stays open so the user can copy/read; they close it manually.
        } catch (e) {
            console.error("Failed to save cover letter to application", e);
            toast.error(
                `Could not save cover letter: ${e instanceof Error ? e.message : "Unexpected error"}`,
            );
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Generate Cover Letter</DialogTitle>
                </DialogHeader>

                <div className="py-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
                        </div>
                    ) : (
                        <CoverLetterSection
                            initialContent={application.cover_letter || ""}
                            jobUrl={application.job_url}
                            resumeContent={resumeContent}
                            onSave={handleSave}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
