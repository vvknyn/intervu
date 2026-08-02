"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    CheckCircle,
    ArrowRight,
    ArrowsClockwise,
    Upload
} from "@phosphor-icons/react";
import { ApplicationDraft } from "../ApplicationWizard";
import { ResumeData } from "@/types/resume";
import { useRouter } from "next/navigation";
import { createApplicationDraft } from "@/actions/applications";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { saveResumeData } from "@/actions/resume";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";

interface ResumeTailoringStepProps {
    draft: ApplicationDraft;
    onUpdate: (updates: Partial<ApplicationDraft>) => void;
    resumeData: ResumeData | null;
    resumeLoading: boolean;
    resumeError: string | null;
    onResumeLoaded: (data: ResumeData) => void;
}

export function ResumeTailoringStep({ draft, onUpdate, resumeData, resumeLoading, resumeError, onResumeLoaded }: ResumeTailoringStepProps) {
    const router = useRouter();
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [versionName, setVersionName] = useState(
        draft.versionName || `${draft.jobAnalysis?.companyName || 'Company'} - ${draft.jobAnalysis?.positionTitle || 'Role'}`
    );
    const [importModalOpen, setImportModalOpen] = useState(false);

    // Update version name when job analysis loads (if still default)
    useEffect(() => {
        if (draft.jobAnalysis?.companyName && draft.jobAnalysis?.positionTitle) {
            const newName = `${draft.jobAnalysis.companyName} - ${draft.jobAnalysis.positionTitle}`;
            // If current name is generic or empty, update it
            if (!versionName || versionName === "Company - Role" || versionName === "Company - " || versionName.startsWith("Company -")) {
                setVersionName(newName);
                onUpdate({ versionName: newName });
            }
        }
    }, [draft.jobAnalysis?.companyName, draft.jobAnalysis?.positionTitle]);

    // Handle resume import from modal
    const handleResumeImported = async (data: ResumeData, importSource: 'pdf' | 'docx' | 'text', confidence: number) => {
        await saveResumeData(data, importSource, confidence);
        onResumeLoaded(data);
        onUpdate({ baseResume: data });
        setImportModalOpen(false);
    };

    // Handle "Tailor in Builder" - saves draft and redirects
    const handleTailorInBuilder = async () => {
        setIsCreatingDraft(true);
        try {
            // Save the draft to get an ID
            const result = await createApplicationDraft(draft);

            if (result.error) {
                throw new Error(result.error);
            }

            if (result.data?.id) {
                // Clear wizard cache since we've "graduated" to a real application
                sessionStorage.removeItem("interview-os:wizard-draft");

                // Redirect to Resume Builder with application context
                router.push(`/resume-builder?applicationId=${result.data.id}&openTailoring=true&source=applications`);
            }
        } catch (e: any) {
            setError(e.message || "Failed to create application");
            setIsCreatingDraft(false);
        }
    };

    // Sync resume data into draft when it arrives from the wizard
    useEffect(() => {
        if (resumeData && !draft.baseResume) {
            onUpdate({ baseResume: resumeData });
        }
    }, [resumeData]);

    const handleVersionNameChange = (name: string) => {
        setVersionName(name);
        onUpdate({ versionName: name });
    };

    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight">Tailor Your Resume</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {resumeData
                        ? "Choose how you want to tailor your resume for this application."
                        : "Import your resume to attach it to this application."
                    }
                </p>
            </div>

            {/* Section 1: Resume Status Card */}
            {resumeLoading ? (
                <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-muted animate-pulse" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                            <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                        </div>
                    </div>
                </div>
            ) : resumeData ? (
                <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] border border-green-200 dark:border-green-800/50 overflow-hidden">
                    <div className="p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 shrink-0">
                            <CheckCircle size={20} weight="fill" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                                {resumeData.profile?.name || resumeData.profile?.profession || "Resume loaded"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {resumeData.experience?.length || 0} experience entries
                                {resumeData.competencies?.length ? ` · ${resumeData.competencies.length} skill categories` : ""}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setImportModalOpen(true)}
                            className="gap-1.5 shrink-0"
                        >
                            <ArrowsClockwise size={14} />
                            Re-import
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] border border-amber-200 dark:border-amber-800/50 overflow-hidden">
                    <div className="p-6 flex flex-col items-center text-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Upload size={28} />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-foreground">
                                {resumeError ? "Couldn't Load Resume" : "Import Your Resume"}
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                                {resumeError
                                    ? "There was an issue loading your resume. You can re-import it here."
                                    : "Import your resume to attach it to this application."
                                }
                            </p>
                        </div>
                        <Button
                            onClick={() => setImportModalOpen(true)}
                            className="gap-2"
                            size="lg"
                            variant="brand"
                        >
                            <Upload size={18} />
                            Import Resume
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            You can also skip this step and track the application without resume tailoring.
                        </p>
                    </div>
                </div>
            )}

            {/* Section 2: Version name + MCP handoff (only when resumeData exists) */}
            {resumeData && (
                <>
                    <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] p-6">
                        <Label htmlFor="versionName">Version Name</Label>
                        <Input
                            id="versionName"
                            value={versionName}
                            onChange={(e) => handleVersionNameChange(e.target.value)}
                            placeholder="e.g., Google - Senior Engineer"
                            className="mt-2"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                            This will be saved as a new version in your resume history.
                        </p>
                    </div>

                    <McpHandoffNote />

                    <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 flex items-center gap-3">
                        <ArrowRight size={20} className="text-brand shrink-0" weight="bold" />
                        <p className="text-sm font-medium text-foreground">
                            Resume attached — click <strong>Continue</strong> to proceed.
                        </p>
                    </div>
                </>
            )}

            {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                    {error}
                </div>
            )}

            {/* Section 4: Secondary "Open in Builder" link */}
            {resumeData && (
                <p className="text-center text-xs text-muted-foreground mt-6">
                    Want deeper control?{' '}
                    <button onClick={handleTailorInBuilder} disabled={isCreatingDraft} className="text-brand hover:underline font-medium">
                        {isCreatingDraft ? "Saving..." : "Open in Resume Builder"}
                    </button>
                </p>
            )}

            {/* Section 5: Import modal */}
            <ResumeImportModal
                isOpen={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onImport={handleResumeImported}
            />
        </div>
    );
}
