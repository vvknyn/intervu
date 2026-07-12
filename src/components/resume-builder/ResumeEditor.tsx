"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ResumeData } from "@/types/resume";
import { LiveResumePreview } from "./LiveResumePreview";
import { EditingPanel } from "./EditingPanel";
import { AIWritingModal } from "./AIWritingModal";
import { Button } from "@/components/ui/button";
import { Trash, Upload, DownloadSimple, CloudArrowUp, CloudSlash, CloudCheck, Check, Printer } from "@phosphor-icons/react";
import { generateSummary, generateExperienceBullets } from "@/actions/generate-resume-content";
import { ProviderConfig } from "@/lib/llm/types";
import { exportToDocx } from "@/lib/export-docx";
import { toast } from "@/lib/toast";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";


type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

// SSR-safe "has mounted" check (avoids the setState-in-effect anti-pattern —
// `document.body` doesn't exist during SSR, so the print portal can only
// render once we're definitely on the client).
const subscribeNever = () => () => {};
function useMounted(): boolean {
    return useSyncExternalStore(subscribeNever, () => true, () => false);
}

interface ResumeEditorProps {
    data: ResumeData;
    onUpdate: (data: Partial<ResumeData>) => void;
    onClear: () => void;
    onImport?: () => void;
    syncStatus?: 'saved' | 'saving' | 'offline' | 'error';
    originalData?: ResumeData | null; // For highlighting diff in tailored mode
    isTailoredMode?: boolean; // Highlight changes in editing panel
    versionsToggle?: React.ReactNode; // Optional custom component to render in top-right
}

export function ResumeEditor({ data, onUpdate, onClear, onImport, syncStatus = 'saved', versionsToggle, originalData, isTailoredMode }: ResumeEditorProps) {
    const [selectedSection, setSelectedSection] = useState<string | null>(null);
    const [aiModalOpen, setAiModalOpen] = useState(false);
    const [currentAISection, setCurrentAISection] = useState<string | null>(null);
    const handleDownloadWord = async () => {
        await exportToDocx(data);
    };

    // Portal target for the print copy only exists client-side.
    const mounted = useMounted();

    // Native print, not canvas rasterization. The on-screen preview sits
    // inside a scale() transform wrapper (see the mobile zoom wrapper below),
    // which corrupts browser print — so a separate, untransformed, portaled
    // copy (#resume-print-root) is what actually gets printed; see the
    // scoped `@media print` rule in globals.css.
    const handlePrint = () => {
        const root = document.documentElement;
        root.classList.add("printing-resume");
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            root.classList.remove("printing-resume");
        };
        window.addEventListener("afterprint", cleanup, { once: true });
        // Safety net: `afterprint` doesn't fire reliably in every browser.
        setTimeout(cleanup, 5000);
        window.print();
    };

    const handleGenerateWithAI = (section: string) => {
        setCurrentAISection(section);
        setAiModalOpen(true);
    };

    // Surface an AI-action error, branching on the cost/auth gate's sentinels.
    const showAIError = (err: unknown, fallback: string) => {
        const sentinel = classifySentinel(err);
        if (sentinel === "auth") {
            toast.info(sentinelMessage(err) || "Sign in to use the built-in AI (or add your own key in Settings).");
        } else if (sentinel === "credits") {
            toast.error(sentinelMessage(err), 7000);
        } else {
            const msg = typeof err === "string" ? err : err instanceof Error ? err.message : fallback;
            toast.error(msg || fallback);
        }
    };

    const handleAIGenerate = async (params: any) => {
        if (!currentAISection) return;

        try {
            if (currentAISection === "summary") {
                const skills = params.skillsText ? params.skillsText.split(',').map((s: string) => s.trim()) : [];
                const result = await generateSummary({
                    role: params.role || "",
                    yearsExperience: params.yearsExperience || 0,
                    keySkills: skills
                });

                if (result.error) {
                    showAIError(result.error, "Failed to generate summary.");
                    return;
                }

                if (result.summary) {
                    onUpdate({ generatedSummary: result.summary });
                    setAiModalOpen(false);
                }
            } else if (currentAISection.startsWith("experience-")) {
                const expId = currentAISection.replace("experience-", "");
                const exp = data.experience?.find(e => e.id === expId);

                if (!exp) return;

                const result = await generateExperienceBullets({
                    role: exp.role || "",
                    company: exp.company || "",
                    description: params.description || ""
                });

                if (result.error) {
                    showAIError(result.error, "Failed to generate bullet points.");
                    return;
                }

                if (result.bullets && result.bullets.length > 0) {
                    const bulletText = result.bullets.map(b => `• ${b}`).join('\n');
                    onUpdate({
                        experience: data.experience?.map(e =>
                            e.id === expId ? { ...e, description: bulletText } : e
                        )
                    });
                    setAiModalOpen(false);
                }
            }
        } catch (error) {
            console.error("AI Generation Error:", error);
            showAIError(error, "Failed to generate content. Please try again.");
        }
    };

    const [mobileTab, setMobileTab] = useState<'preview' | 'edit'>('edit');

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Toolbar */}
            <div className="border-b border-border bg-background z-40">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                        {syncStatus === 'saving' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <CloudArrowUp size={12} weight="bold" className="animate-pulse" />
                                Saving...
                            </span>
                        )}
                        {syncStatus === 'saved' && (
                            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                <CloudCheck size={12} weight="bold" />
                                Saved
                            </span>
                        )}
                        {syncStatus === 'offline' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <CloudSlash size={12} weight="bold" />
                                Saved on this device &mdash; <a href="/login" className="underline hover:text-foreground transition-colors">log in</a> to sync
                            </span>
                        )}
                        {syncStatus === 'error' && (
                            <span className="text-xs text-destructive flex items-center gap-1">
                                <CloudSlash size={12} weight="bold" />
                                Sync error
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* Import Button */}
                        {onImport && (
                            <button
                                onClick={onImport}
                                className="group hidden sm:inline-flex items-center h-8 px-2.5 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-all duration-200"
                            >
                                <Upload size={15} weight="bold" className="text-muted-foreground group-hover:text-brand shrink-0" />
                                <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                    <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">Import</span>
                                </span>
                            </button>
                        )}

                        {/* Clear Button */}
                        <button
                            onClick={onClear}
                            className="group hidden sm:inline-flex items-center h-8 px-2.5 rounded-md border border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/10 transition-all duration-200"
                        >
                            <Trash size={15} weight="regular" className="shrink-0" />
                            <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">Clear</span>
                            </span>
                        </button>

                        {/* Versions Toggle */}
                        {versionsToggle}

                        {/* Print / PDF Button */}
                        <button
                            onClick={handlePrint}
                            className="group hidden sm:inline-flex items-center h-8 px-2.5 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-all duration-200"
                        >
                            <Printer size={15} weight="bold" className="text-muted-foreground group-hover:text-brand shrink-0" />
                            <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">Print / PDF</span>
                            </span>
                        </button>

                        {/* Export Button */}
                        <button
                            onClick={handleDownloadWord}
                            className="group inline-flex items-center h-8 px-2.5 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-all duration-200"
                        >
                            <DownloadSimple size={15} weight="bold" className="shrink-0" />
                            <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">.docx</span>
                            </span>
                        </button>
                    </div>
                </div>

                {/* Mobile Tab Switcher */}
                <div className="lg:hidden border-t border-border px-4 py-2 bg-secondary/20">
                    <div className="grid grid-cols-2 gap-2 bg-secondary/50 p-1 rounded-lg">
                        <button
                            onClick={() => setMobileTab('edit')}
                            className={`text-sm font-medium py-1.5 rounded-md transition-all ${mobileTab === 'edit'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            Editor
                        </button>
                        <button
                            onClick={() => setMobileTab('preview')}
                            className={`text-sm font-medium py-1.5 rounded-md transition-all ${mobileTab === 'preview'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            Preview
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative">
                <div className="max-w-[1600px] mx-auto h-full flex lg:gap-0">
                    {/* Left: Live Preview (Hidden on mobile unless active) */}
                    <div className={`
                        lg:w-[45%] lg:block lg:border-r border-border bg-muted/30 overflow-y-auto overflow-x-hidden p-4 lg:p-6
                        absolute inset-0 lg:static z-20 lg:z-auto bg-background lg:bg-muted/30
                        ${mobileTab === 'preview' ? 'block' : 'hidden'}
                    `}>
                        {/* Mobile Zoom Wrapper */}
                        <div className="min-w-[8.5in] lg:min-w-0 transform origin-top-left scale-[0.45] sm:scale-[0.6] md:scale-[0.75] lg:scale-[0.82] xl:scale-[0.92] 2xl:scale-100 h-full">
                            <LiveResumePreview
                                data={data}
                                onEdit={(section) => {
                                    setSelectedSection(section);
                                    setMobileTab('edit'); // Switch to edit on click
                                }}
                                selectedSection={selectedSection}
                                originalData={originalData} // Pass for diff highlighting
                            />
                        </div>
                    </div>

                    {/* Right: Editing Panel (Hidden on mobile unless active) */}
                    <div className={`
                        flex-1 overflow-hidden bg-background
                        absolute inset-0 lg:static z-20 lg:z-auto
                        ${mobileTab === 'edit' ? 'block' : 'hidden'}
                    `}>
                        <EditingPanel
                            selectedSection={selectedSection}
                            data={data}
                            onUpdate={onUpdate}
                            onGenerateWithAI={handleGenerateWithAI}
                            onNavigateSection={(section) => setSelectedSection(section)}
                        />
                    </div>
                </div>
            </div>

            {/* AI Modal */}
            <AIWritingModal
                isOpen={aiModalOpen}
                onClose={() => setAiModalOpen(false)}
                section={currentAISection || ""}
                onGenerate={handleAIGenerate}
                experienceContext={
                    currentAISection?.startsWith("experience-")
                        ? (() => {
                            const expId = currentAISection.replace("experience-", "");
                            const exp = data.experience?.find(e => e.id === expId);
                            return exp ? {
                                role: exp.role || "",
                                company: exp.company || "",
                                dates: exp.dates || "",
                                existingDescription: exp.description || ""
                            } : undefined;
                        })()
                        : undefined
                }
                summaryContext={
                    currentAISection === "summary"
                        ? {
                            profession: data.profile.profession || "",
                            yearsOfExperience: data.profile.yearsOfExperience || 0,
                            skills: data.competencies?.flatMap(c => c.skills) || []
                        }
                        : undefined
                }
            />

            {/* Print-only copy: untransformed (no scale() wrapper), portaled to
                <body> so it sits outside the app shell. Only #resume-print-root
                is made visible when `html.printing-resume` is set — see the
                scoped @media print rule in globals.css. */}
            {mounted &&
                createPortal(
                    <div id="resume-print-root" className="hidden">
                        <LiveResumePreview data={data} onEdit={() => {}} selectedSection={null} printMode />
                    </div>,
                    document.body,
                )}
        </div>
    );
}
