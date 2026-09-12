"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { chipVariants } from "@/components/ui/chip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { parseResumeWithAI } from "@/actions/resume";
import { EXPERIENCE_LEVELS, WORK_TYPES, type ExperienceLevel, type WorkType } from "@/lib/agent/facets";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import { readLocalAiEnabled } from "@/lib/local-ai/flag";
import { parseResumeLocally } from "@/lib/local-ai/parse-resume";
import { canSavePrefsOnboarding } from "@/lib/jobs/prefs-onboarding";
import { extractResumeFileText, resumeFileExtension } from "@/lib/resume/extract-file-text";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { SearchPreferences } from "@/lib/agent/preferences";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

interface PrefsOnboardingDialogProps {
    open: boolean;
    draft: SearchPreferences;
    hasUsableResume: boolean;
    onResumeImported: (data: ResumeData) => void;
    onSave: (search: SearchPreferences) => Promise<void>;
    onDismiss: () => void | Promise<void>;
}

/**
 * One-shot dialog for first-time personalization — résumé first, then rails
 * prefilled from the parse. Save or Skip marks onboarding complete; later
 * edits live in Settings → Job search.
 */
export function PrefsOnboardingDialog({
    open,
    draft,
    hasUsableResume,
    onResumeImported,
    onSave,
    onDismiss,
}: PrefsOnboardingDialogProps) {
    const [location, setLocation] = useState(draft.location ?? "");
    const [workMode, setWorkMode] = useState<WorkType | undefined>(draft.workMode);
    const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | undefined>(
        draft.experienceLevel as ExperienceLevel | undefined,
    );
    const [salaryMin, setSalaryMin] = useState(draft.salaryMin !== undefined ? String(draft.salaryMin) : "");
    const [saving, setSaving] = useState(false);

    const [pastedText, setPastedText] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [resumeParsing, setResumeParsing] = useState(false);
    const [resumeError, setResumeError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setLocation(draft.location ?? "");
        setWorkMode(draft.workMode);
        setExperienceLevel(draft.experienceLevel as ExperienceLevel | undefined);
        setSalaryMin(draft.salaryMin !== undefined ? String(draft.salaryMin) : "");
    }, [open, draft]);

    const toggleWorkMode = (mode: WorkType) => {
        setWorkMode((current) => (current === mode ? undefined : mode));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!resumeFileExtension(file.name)) {
            setResumeError("Unsupported file type. Please use .txt, .md, .pdf, or .docx.");
            return;
        }
        setSelectedFile(file);
        setResumeError(null);
    };

    const parseAndImport = useCallback(async () => {
        setResumeParsing(true);
        setResumeError(null);
        try {
            let textContent: string;
            let contentType: "pdf" | "docx" | "text" = "text";

            if (selectedFile) {
                textContent = await extractResumeFileText(selectedFile);
                const ext = resumeFileExtension(selectedFile.name);
                if (ext === "pdf") contentType = "pdf";
                else if (ext === "docx" || ext === "doc") contentType = "docx";
            } else if (pastedText.trim()) {
                textContent = pastedText.trim();
            } else {
                throw new Error("Upload a file or paste your résumé.");
            }

            let parsed: ResumeData | undefined;
            if (readLocalAiEnabled()) {
                parsed = (await parseResumeLocally(textContent)).data.parsed;
            } else {
                const result = await parseResumeWithAI(textContent, contentType);
                if (result.error) throw new Error(result.error);
                parsed = result.data?.parsed;
            }

            if (!parsed || !resumeIsUsable(parsed)) {
                throw new Error("Could not parse a usable résumé. Try pasting plain text or a clearer file.");
            }

            onResumeImported(parsed);
            setPastedText("");
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err) {
            setResumeError(err instanceof Error ? err.message : "Failed to parse résumé.");
        } finally {
            setResumeParsing(false);
        }
    }, [onResumeImported, pastedText, selectedFile]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const search: SearchPreferences = {
                location: location.trim() || undefined,
                workMode,
                remoteOnly: workMode === "remote" ? true : undefined,
                experienceLevel,
                salaryMin: salaryMin.trim() ? Number(salaryMin) : undefined,
            };
            await onSave(search);
        } finally {
            setSaving(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) void onDismiss();
    };

    const saveEnabled = canSavePrefsOnboarding({ hasUsableResume });

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                data-testid="prefs-onboarding-dialog"
                className={cn(
                    "z-[70] flex w-full max-w-none flex-col overflow-hidden p-0",
                    "top-auto right-0 bottom-0 left-0 max-h-[95dvh] translate-x-0 translate-y-0",
                    "sm:top-[50%] sm:right-auto sm:bottom-auto sm:left-[50%] sm:max-h-[85dvh] sm:max-w-xl sm:translate-x-[-50%] sm:translate-y-[-50%]",
                )}
            >
                <div className="flex min-h-0 max-h-[95dvh] flex-col sm:max-h-[85dvh]">
                    <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
                        <DialogHeader className="space-y-1 text-left">
                            <DialogTitle className="text-base font-semibold leading-snug text-foreground">
                                Personalize your job feed
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Add your résumé, then confirm a few defaults — we&apos;ll rank jobs for you.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                        <div className="space-y-5">
                            {!hasUsableResume ? (
                                <div className="space-y-3" data-testid="prefs-onboarding-resume">
                                    <p className="text-sm text-foreground">
                                        Upload or paste your résumé to unlock ranked matches.
                                    </p>
                                    <Input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".txt,.md,.pdf,.docx,.doc"
                                        onChange={handleFileChange}
                                        className="h-9 w-full rounded-none text-xs file:mr-2 file:border-0 file:bg-transparent file:text-xs file:font-semibold"
                                        data-testid="prefs-onboarding-resume-file"
                                    />
                                    <Textarea
                                        value={pastedText}
                                        onChange={(e) => setPastedText(e.target.value)}
                                        placeholder="Or paste résumé text"
                                        className="min-h-[100px] w-full rounded-none text-xs"
                                        data-testid="prefs-onboarding-resume-paste"
                                    />
                                    {resumeError && (
                                        <p className="text-xs text-destructive">{resumeError}</p>
                                    )}
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-9 w-full rounded-none text-xs sm:w-auto"
                                        disabled={resumeParsing || (!selectedFile && !pastedText.trim())}
                                        onClick={() => void parseAndImport()}
                                        data-testid="prefs-onboarding-resume-parse"
                                    >
                                        {resumeParsing ? "Parsing…" : "Use this résumé"}
                                    </Button>
                                </div>
                            ) : (
                                <p
                                    className="text-sm text-muted-foreground"
                                    data-testid="prefs-onboarding-resume-ready"
                                >
                                    Résumé on file — confirm your search defaults below.
                                </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <Input
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    placeholder="Location"
                                    className="h-9 w-full rounded-none text-xs sm:max-w-[180px]"
                                />
                                {WORK_TYPES.map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => toggleWorkMode(mode)}
                                        className={chipVariants({ active: workMode === mode })}
                                    >
                                        {facetValueLabel("work_type", mode)}
                                    </button>
                                ))}
                                {EXPERIENCE_LEVELS.slice(0, 3).map((lvl) => (
                                    <button
                                        key={lvl}
                                        type="button"
                                        onClick={() =>
                                            setExperienceLevel((current) => (current === lvl ? undefined : lvl))
                                        }
                                        className={chipVariants({ active: experienceLevel === lvl })}
                                    >
                                        {facetValueLabel("experience_level", lvl)}
                                    </button>
                                ))}
                                <Input
                                    type="number"
                                    min={0}
                                    value={salaryMin}
                                    onChange={(e) => setSalaryMin(e.target.value)}
                                    placeholder="Min salary"
                                    className="h-9 w-full rounded-none text-xs sm:max-w-[120px]"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 w-full rounded-none text-xs sm:w-auto"
                            onClick={() => void onDismiss()}
                        >
                            Skip
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="h-9 w-full rounded-none text-xs sm:w-auto"
                            onClick={() => void handleSave()}
                            disabled={saving || !saveEnabled}
                            data-testid="prefs-onboarding-save"
                        >
                            {saving ? "Saving…" : "Save & rank"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
