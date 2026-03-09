"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Application, updateApplication } from "@/actions/application";
import { CoverLetterSection } from "./CoverLetterSection";
import { fetchTailoredVersions } from "@/actions/tailor-resume";
import { fetchResumeData } from "@/actions/resume";
import { ResumeData } from "@/types/resume";

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
            await updateApplication(application.id, { cover_letter: content });
            onSuccess();
            // We don't close automatically here to let user copy/read it, 
            // but the CoverLetterSection has a copy button. 
            // The user can close the modal manually.
            // Actually, for "Save", it usually implies committing. 
            // Let's just update the backend. The user can close when ready.
        } catch (e) {
            console.error("Failed to save cover letter to application", e);
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
