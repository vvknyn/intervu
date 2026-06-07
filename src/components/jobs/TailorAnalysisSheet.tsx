"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleNotch, FileText, Sparkle, Warning, X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { JobAnalysisPanel } from "@/components/resume-tailor/JobAnalysisPanel";
import { RecommendationsPanel } from "@/components/resume-tailor/RecommendationsPanel";
import {
    analyzeJobRequirements,
    generateTailoringRecommendations,
    saveTailoredVersion,
} from "@/actions/tailor-resume";
import { fetchResumeData } from "@/actions/resume";
import { applyRecommendations } from "@/lib/resume/apply-recommendations";
import type { JobAnalysis, ResumeData, TailoringRecommendation } from "@/types/resume";
import { classifySentinel } from "@/lib/llm/sentinels";
import { toast } from "@/lib/toast";

const RESUME_STORAGE_KEY = "interview-os-resume-data";

/** The job to tailor against — already decoded/cleaned by the caller. */
export interface TailorJob {
    company: string;
    position: string;
    description: string;
    /** Apply/posting URL — used to fetch the posting when no description was captured. */
    url?: string;
}

/**
 * In-place job-analysis + tailoring slideout for the Find-jobs page. Clicking
 * "Apply with tailored resume" opens this immediately (showing an analyzing
 * state), runs the analysis on the spot, then offers tailoring recommendations
 * — no navigation to /resume-tailor. Reuses the shared JobAnalysisPanel /
 * RecommendationsPanel + the same server actions, so behavior matches the
 * dedicated tailor page. resume-tailor keeps its own copy of this flow.
 */
export function TailorAnalysisSheet({
    open,
    onOpenChange,
    job,
    onAuthRequired,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    job: TailorJob | null;
    /** Called when an action fails because the user isn't authenticated. */
    onAuthRequired?: () => void;
}) {
    const [resumeData, setResumeData] = useState<ResumeData | null>(null);
    const [view, setView] = useState<"analysis" | "recommendations">("analysis");
    const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
    const [recommendations, setRecommendations] = useState<TailoringRecommendation[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Track which job we've analyzed so re-opening the same job doesn't re-run the LLM.
    const analyzedKeyRef = useRef<string | null>(null);
    const resumeLoadedRef = useRef(false);

    const jobKey = job ? `${job.company}|${job.position}|${job.description.slice(0, 120)}` : null;

    // Lazy-load the resume the first time the sheet opens (guest → localStorage).
    useEffect(() => {
        if (!open || resumeLoadedRef.current) return;
        resumeLoadedRef.current = true;
        (async () => {
            try {
                const { data } = await fetchResumeData();
                if (data) {
                    setResumeData(data);
                    return;
                }
            } catch {
                /* fall through to localStorage */
            }
            try {
                const saved = localStorage.getItem(RESUME_STORAGE_KEY);
                if (saved) setResumeData(JSON.parse(saved));
            } catch {
                /* no resume available — handled in the footer */
            }
        })();
    }, [open]);

    const runAnalysis = useCallback(async (j: TailorJob) => {
        setIsAnalyzing(true);
        setError(null);
        setAnalysis(null);
        setRecommendations([]);
        setView("analysis");
        try {
            const res = await analyzeJobRequirements(j.description, j.url);
            if (res.error) {
                if (classifySentinel(res.error) === "auth") onAuthRequired?.();
                else setError(res.error);
                return;
            }
            if (res.data) setAnalysis(res.data);
        } catch (e) {
            if (classifySentinel(e) === "auth") onAuthRequired?.();
            else setError(e instanceof Error ? e.message : "Failed to analyze this role.");
        } finally {
            setIsAnalyzing(false);
        }
    }, [onAuthRequired]);

    // Auto-analyze when the sheet opens for a new job.
    useEffect(() => {
        if (!open || !job || !jobKey) return;
        if (analyzedKeyRef.current === jobKey) return;
        analyzedKeyRef.current = jobKey;
        void runAnalysis(job);
    }, [open, job, jobKey, runAnalysis]);

    const handleGenerate = async () => {
        if (!analysis) return;
        if (!resumeData) {
            setError("Add your resume first to get tailoring suggestions.");
            return;
        }
        setIsGenerating(true);
        setError(null);
        try {
            const res = await generateTailoringRecommendations(resumeData, analysis);
            if (res.error) {
                if (classifySentinel(res.error) === "auth") onAuthRequired?.();
                else setError(res.error);
                return;
            }
            if (res.data) {
                setRecommendations(res.data);
                setView("recommendations");
            }
        } catch (e) {
            if (classifySentinel(e) === "auth") onAuthRequired?.();
            else setError(e instanceof Error ? e.message : "Failed to generate recommendations.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveVersion = async (versionName: string, applied: TailoringRecommendation[]) => {
        if (!resumeData || !analysis) return;
        const { tailoredSummary, tailoredExperience, tailoredCompetencies } = applyRecommendations(
            resumeData,
            applied,
        );
        try {
            const res = await saveTailoredVersion({
                versionName,
                jobAnalysisId: analysis.id,
                originalSummary: resumeData.generatedSummary,
                originalExperience: resumeData.experience,
                originalCompetencies: resumeData.competencies,
                originalProfile: resumeData.profile,
                originalEducation: resumeData.education,
                sectionOrder: resumeData.sectionOrder,
                tailoredSummary,
                tailoredExperience,
                tailoredCompetencies,
                recommendations: applied,
                companyName: analysis.companyName,
                positionTitle: analysis.positionTitle,
                appliedAt: new Date().toISOString(),
            });
            if (res.error) {
                if (classifySentinel(res.error) === "auth") onAuthRequired?.();
                else toast.error(`Could not save: ${res.error}`);
                return;
            }
            toast.success("Tailored version saved.");
        } catch (e) {
            if (classifySentinel(e) === "auth") onAuthRequired?.();
            else toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="p-0 flex flex-col overflow-hidden sm:max-w-xl w-full" hideCloseButton>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-card sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        {view === "recommendations" && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setView("analysis")}
                                className="h-8 w-8 -ml-2 rounded-full mr-1"
                            >
                                <ArrowRight size={16} className="rotate-180" />
                            </Button>
                        )}
                        <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                            {view === "analysis" ? (
                                <FileText size={16} className="text-brand" />
                            ) : (
                                <Sparkle size={16} className="text-brand" />
                            )}
                        </div>
                        <div>
                            <SheetTitle className="text-lg font-semibold">
                                {view === "analysis" ? "Job Analysis" : "Tailoring Recommendations"}
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Analyze this role and tailor your resume to it.
                            </SheetDescription>
                            {view === "recommendations" && (
                                <p className="text-xs text-muted-foreground">{recommendations.length} suggestions found</p>
                            )}
                            {view === "analysis" && job && (
                                <p className="max-w-[20rem] truncate text-xs text-muted-foreground">
                                    {job.position}
                                    {job.company ? ` · ${job.company}` : ""}
                                </p>
                            )}
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenChange(false)}
                        className="h-8 w-8 rounded-full"
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto bg-card">
                    {view === "analysis" ? (
                        <div className="px-6 py-6">
                            {isAnalyzing ? (
                                <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
                                    <div className="relative flex h-12 w-12 items-center justify-center">
                                        <div className="absolute inset-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                                        <Sparkle size={18} className="text-brand" weight="fill" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold">Analyzing this role…</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Extracting requirements, skills, and culture signals
                                        </p>
                                    </div>
                                </div>
                            ) : error ? (
                                <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
                                    <Warning size={28} className="text-muted-foreground/60" />
                                    <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
                                    {job && (
                                        <Button variant="outline" size="sm" onClick={() => runAnalysis(job)}>
                                            Try again
                                        </Button>
                                    )}
                                </div>
                            ) : analysis ? (
                                <JobAnalysisPanel analysis={analysis} />
                            ) : null}
                        </div>
                    ) : resumeData ? (
                        <RecommendationsPanel
                            recommendations={recommendations}
                            resumeData={resumeData}
                            onSaveVersion={handleSaveVersion}
                        />
                    ) : null}
                </div>

                {/* Footer (analysis view only) */}
                {view === "analysis" && analysis && !isAnalyzing && !error && (
                    <div className="border-t bg-card px-6 py-4 z-20">
                        {resumeData ? (
                            <Button onClick={handleGenerate} disabled={isGenerating} className="w-full h-11 text-base" size="lg">
                                {isGenerating ? (
                                    <>
                                        <CircleNotch size={16} className="mr-2 animate-spin" />
                                        Generating recommendations…
                                    </>
                                ) : (
                                    <>
                                        <Sparkle size={16} className="mr-2" />
                                        Generate tailoring recommendations
                                        <ArrowRight className="w-4 h-4 ml-2" />
                                    </>
                                )}
                            </Button>
                        ) : (
                            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3 text-center text-[13px] text-muted-foreground">
                                Add your resume to get tailoring suggestions.{" "}
                                <Link href="/resume-builder" className="font-medium text-brand hover:underline">
                                    Build your resume
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
