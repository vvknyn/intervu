"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ResumeData, JobAnalysis, TailoringRecommendation, TailoredResumeVersion } from "@/types/resume";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowRight, Sparkle, CircleNotch, Info as InfoIcon, Warning, X, ArrowsClockwise, FileText } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { analyzeJobRequirements, generateTailoringRecommendations, saveTailoredVersion } from "@/actions/tailor-resume";
import { usePursuits } from "@/lib/pursuits/use-pursuits";
import { resolvePostingText, readAutoTailorCache, writeAutoTailorCache } from "@/lib/resume/auto-tailor";
import { fetchResumeData } from "@/actions/resume";
import { applyRecommendations } from "@/lib/resume/apply-recommendations";
import { fetchProfile } from "@/actions/profile";
import { JobAnalysisPanel } from "@/components/resume-tailor/JobAnalysisPanel";
import { RecommendationsPanel } from "@/components/resume-tailor/RecommendationsPanel";
import { TailoredVersionsList } from "@/components/resume-tailor/TailoredVersionsList";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { MotivationalBanner } from "@/components/ui/motivational-banner";
import { RESUME_MESSAGES } from "@/lib/copy";

import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, signOut as firebaseSignOut, type User } from "@/lib/firebase/client-auth";
import { useRouter } from "next/navigation";

const RESUME_STORAGE_KEY = "interview-os-resume-data";

function ResumeTailorContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const prefilledCompany = searchParams.get("company");
    const prefilledPosition = searchParams.get("position");
    const pursuitId = searchParams.get("pursuit");
    const { pursuits } = usePursuits();

    const [resumeData, setResumeData] = useState<ResumeData | null>(null);
    const [jobInput, setJobInput] = useState("");
    const [jobUrl, setJobUrl] = useState("");
    const [jobAnalysis, setJobAnalysis] = useState<JobAnalysis | null>(null);
    const [recommendations, setRecommendations] = useState<TailoringRecommendation[]>([]);

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [analysisSheetOpen, setAnalysisSheetOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) setUser(currentUser);

        fetchProfile().then(({ data }) => {
            if (data && (data as any).is_admin) setIsAdmin(true);
        });
    }, []);

    const handleSignOut = async () => {
        localStorage.clear();
        await firebaseSignOut();
        window.location.href = "/";
    };

    // Load resume data from DB (authenticated) or localStorage (guest)
    useEffect(() => {
        const loadResume = async () => {
            // Try database first for authenticated users
            const { data: dbData, error } = await fetchResumeData();
            if (dbData && !error) {
                setResumeData(dbData);
                console.log("[ResumeTailor] Loaded from database");
                return;
            }

            // Fall back to localStorage
            const saved = localStorage.getItem(RESUME_STORAGE_KEY);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    setResumeData(data);
                    console.log("[ResumeTailor] Loaded from localStorage");
                } catch (e) {
                    console.error("Failed to load resume data", e);
                }
            }
        };
        loadResume();
    }, []);

    // Prefill job input if coming from dashboard
    useEffect(() => {
        if (prefilledCompany || prefilledPosition) {
            const prefilled = `${prefilledCompany || ""} ${prefilledPosition || ""}`.trim();
            setJobInput(`Looking for job posting information for ${prefilled}`);
        }
    }, [prefilledCompany, prefilledPosition]);

    /**
     * Arriving from a pursuit (/yours/[id] → `?pursuit=<id>`): analyse the
     * posting and produce recommendations without asking for a click. The
     * pursuit already knows which role this is; making the user paste it back
     * was the reason this screen felt like a dead end.
     *
     * Three things this must not do, all of which cost real money or trust:
     *
     *  - Run more than once per pursuit. The guard is a ref, not state, so a
     *    re-render can't retrigger it, and `pursuits` changing identity (it
     *    reloads) can't either.
     *  - Run without a résumé. There is nothing to tailor, so it stays out of
     *    the way and lets the page's own no-résumé state stand — never a
     *    spinner that resolves into nothing.
     *  - Analyse text that isn't the posting. Company + position alone is a
     *    label, not a job description; an "analysis" of it would look like a
     *    result while being worthless. If no real posting text can be
     *    resolved, the manual path stays, prefilled.
     *
     * Results are cached for the session so back-navigation re-opens what you
     * already paid for instead of re-billing two model calls. The cache is
     * per-session by design — a pursuit's posting can change underneath us,
     * and this screen is not the right place to own durable analysis state.
     */
    const autoRanFor = useRef<string | null>(null);

    useEffect(() => {
        if (!pursuitId || !resumeData) return;
        if (autoRanFor.current === pursuitId) return;
        const pursuit = pursuits.find((p) => p.id === pursuitId);
        if (!pursuit) return; // list still loading, or an id that isn't ours

        autoRanFor.current = pursuitId;

        void (async () => {
            const cached = readAutoTailorCache(pursuitId);
            if (cached) {
                setJobAnalysis(cached.analysis);
                setRecommendations(cached.recommendations);
                setSheetState({ isOpen: true, view: "recommendations" });
                return;
            }

            const posting = await resolvePostingText(pursuit);
            if (pursuit.job_url) setJobUrl(pursuit.job_url);
            if (!posting) {
                setJobInput(`Looking for job posting information for ${pursuit.company_name} ${pursuit.position}`.trim());
                return;
            }
            setJobInput(posting);

            const analysis = await handleAnalyzeJob(posting);
            if (!analysis) return; // analyse failed; its own error is already on screen
            const recs = await generateFrom(analysis);
            if (recs) writeAutoTailorCache(pursuitId, analysis, recs);
        })();
        // `handleAnalyzeJob`/`generateFrom` are redefined every render but are
        // guarded by the ref above, so listing them would only add churn.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pursuitId, pursuits, resumeData]);

    const [sheetState, setSheetState] = useState<{ isOpen: boolean; view: 'analysis' | 'recommendations' }>({
        isOpen: false,
        view: 'analysis'
    });

    useEffect(() => {
        // If analysis is ready but not recommendations, show analysis
        if (jobAnalysis && !analysisSheetOpen && !sheetOpen) {
            // Logic to auto-open if needed or just rely on user click
        }
    }, [jobAnalysis]);

    const handleOpenAnalysis = () => {
        setSheetState({ isOpen: true, view: 'analysis' });
    };

    const handleAnalyzeJob = async (inputOverride?: string) => {
        // inputOverride lets callers (e.g. the /jobs auto-analyze) pass the posting directly,
        // bypassing the state-update race. A click event arg is ignored via the typeof guard.
        const input = (typeof inputOverride === "string" ? inputOverride : jobInput).trim();
        if (!input) {
            setError(RESUME_MESSAGES.noJobPosting);
            return;
        }

        setIsAnalyzing(true);
        setError(null);

        try {
            const result = await analyzeJobRequirements(input, jobUrl || undefined);

            if (result.error) {
                setError(result.error);
            } else if (result.data) {
                setJobAnalysis(result.data);
                setRecommendations([]); // Clear old recommendations
                setSheetState({ isOpen: true, view: 'analysis' });
                // Returned as well as stored: a caller that wants to chain
                // straight into recommendations can't read the state it just
                // set (same tick), and re-deriving it would mean a second
                // billed analysis of the same posting.
                return result.data;
            }
        } catch (e: any) {
            setError(e.message || "Failed to analyze job posting");
        } finally {
            setIsAnalyzing(false);
        }
        return null;
    };

    /**
     * Recommendations for an analysis the caller already holds. Split out of
     * `handleGenerateRecommendations` so the auto-tailor path can hand its own
     * analysis straight in — an optional-override parameter would sit on a
     * function wired to onClick, where React passes the click event as the
     * first argument.
     */
    const generateFrom = async (analysis: JobAnalysis) => {
        if (!resumeData) {
            setError(RESUME_MESSAGES.noResumeData);
            return;
        }

        setIsGenerating(true);
        setError(null);
        // Keep sheet open, just show loading state inside if we were using a dedicated loader component
        // But for now we can just rely on isGenerating to show spinner in the button 
        // OR better: transition to recommendations view immediately and show loading there?
        // Let's keep it simple: Stay in analysis view with loading button, then switch.

        try {
            const result = await generateTailoringRecommendations(resumeData, analysis);

            if (result.error) {
                setError(result.error);
            } else if (result.data) {
                setRecommendations(result.data);
                setSheetState({ isOpen: true, view: 'recommendations' });
                return result.data;
            }
        } catch (e: any) {
            setError(e.message || "Failed to generate recommendations");
        } finally {
            setIsGenerating(false);
        }
        return null;
    };

    const handleGenerateRecommendations = async () => {
        if (!jobAnalysis) {
            setError(RESUME_MESSAGES.analyzeFirst);
            return;
        }
        await generateFrom(jobAnalysis);
    };

    const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

    // Initial load from URL
    useEffect(() => {
        const versionId = searchParams.get("versionId");
        if (versionId) {
            setActiveVersionId(versionId);
            // In a real app we might fetch the specific version data here if not already loaded by a parent wrapper
            // For now we assume the user flow starts from analysis or selects a version which sets context
        }
    }, [searchParams]);

    // Prefill the job posting when arriving from /jobs → "Apply with tailored resume".
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem("intervu:tailor-job");
            if (raw) {
                sessionStorage.removeItem("intervu:tailor-job");
                const j = JSON.parse(raw) as { description?: string };
                if (j.description) {
                    setJobInput(j.description);
                    // Description is already present — skip the paste page, analyze immediately.
                    void handleAnalyzeJob(j.description);
                }
            }
        } catch {
            /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSaveVersion = async (versionName: string, appliedRecommendations: TailoringRecommendation[]) => {
        if (!resumeData || !jobAnalysis) return;

        // Apply the accepted rewrites to produce the tailored fields. Previously the
        // tailored* fields were just the ORIGINAL values, so every accepted rec was
        // silently dropped on save. Uses the shared fuzzy-apply chokepoint (also used
        // by the applications wizard) so a near-match rewrite still lands.
        const { tailoredSummary, tailoredExperience, tailoredCompetencies } =
            applyRecommendations(resumeData, appliedRecommendations);

        const tailoredData = {
            id: activeVersionId || undefined, // Pass ID to update if exists
            versionName,
            jobAnalysisId: jobAnalysis.id,
            originalSummary: resumeData.generatedSummary,
            originalExperience: resumeData.experience,
            originalCompetencies: resumeData.competencies,
            originalProfile: resumeData.profile,
            originalEducation: resumeData.education,
            sectionOrder: resumeData.sectionOrder,
            tailoredSummary,
            tailoredExperience,
            tailoredCompetencies,
            recommendations: appliedRecommendations,
            companyName: jobAnalysis.companyName,
            positionTitle: jobAnalysis.positionTitle,
            jobPosting: jobAnalysis.jobText, // Include the job posting
            appliedAt: new Date().toISOString() // Update applied time on save
        };

        const result = await saveTailoredVersion(tailoredData);

        if (result.error) {
            setError(result.error);
        } else if (result.data) {
            console.log("Version saved successfully!");
            setActiveVersionId(result.data.id); // Set active ID after save
            // Trigger list refresh
            window.dispatchEvent(new Event('version-updated'));
        }
    };

    const handleFetchUrl = async () => {
        if (!jobUrl.trim()) return;
        setIsAnalyzing(true);
        setError(null);

        try {
            const { fetchUrlContent } = await import("@/actions/fetch-url");
            const result = await fetchUrlContent(jobUrl);

            if (result.error) {
                setError(result.error);
            } else if (result.data) {
                setJobInput(result.data);
            }
        } catch (e: any) {
            setError(e.message || "Failed to fetch URL");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const savedVersionsSidebar = (
        <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-semibold">Saved Versions</h3>
            </div>
            <TailoredVersionsList />
        </div>
    );

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Tailor Resume"
                    actions={
                        <>
                            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                        </>
                    }
                />
            }
            sidebar={savedVersionsSidebar}
        >
            <MotivationalBanner />
            <div className="space-y-6 sm:space-y-8">
                {!resumeData && (
                    <div className="p-4 sm:p-6 bg-yellow-50/50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-800 dark:text-yellow-200 flex items-center gap-3">
                        <InfoIcon size={20} className="shrink-0" />
                        <p className="text-sm sm:text-base">No resume found. Please <Link href="/resume-builder" className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100">create a resume</Link> first.</p>
                    </div>
                )}

                {error && (
                    <div className="p-4 sm:p-6 bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 flex items-center gap-3">
                        <Warning size={20} className="shrink-0" />
                        <p className="text-sm sm:text-base">{error}</p>
                        <button onClick={() => setError(null)} className="ml-auto hover:opacity-70">
                            <X size={16} />
                        </button>
                    </div>
                )}

                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg sm:text-xl font-semibold">Job Posting</h2>
                        {jobAnalysis && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleOpenAnalysis}
                                className="text-xs"
                            >
                                <FileText size={14} className="mr-1.5" />
                                View Analysis
                            </Button>
                        )}
                    </div>

                    <Card className="border-border shadow-sm">
                        <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                            <div className="space-y-3">
                                <label htmlFor="tailor-job-url" className="text-sm font-medium text-foreground/80">
                                    Job URL (Optional)
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        id="tailor-job-url"
                                        placeholder="https://company.com/careers/job-123"
                                        value={jobUrl}
                                        onChange={(e) => setJobUrl(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleFetchUrl();
                                            }
                                        }}
                                        className="bg-background"
                                    />
                                    <Button
                                        variant="secondary"
                                        onClick={handleFetchUrl}
                                        disabled={isAnalyzing || !jobUrl.trim()}
                                    >
                                        Fetch
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label htmlFor="tailor-job-description" className="text-sm font-medium text-foreground/80">
                                    Job Description *
                                </label>
                                <Textarea
                                    id="tailor-job-description"
                                    placeholder="Paste the full job posting text here..."
                                    value={jobInput}
                                    onChange={(e) => setJobInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                            e.preventDefault();
                                            handleAnalyzeJob();
                                        }
                                    }}
                                    rows={12}
                                    className="font-mono text-sm leading-relaxed bg-background resize-y min-h-[200px] sm:min-h-[300px]"
                                />
                            </div>

                            <Button
                                onClick={() => handleAnalyzeJob()}
                                disabled={isAnalyzing || !jobInput.trim() || !resumeData}
                                variant="brand"
                                className="w-full h-11 sm:h-12 text-sm sm:text-base shadow-sm"
                                size="lg"
                            >
                                {isAnalyzing ? (
                                    <>
                                        <CircleNotch size={20} className="mr-2 animate-spin" />
                                        Analyzing Job Posting...
                                    </>
                                ) : (
                                    <>
                                        <Sparkle size={20} className="mr-2" />
                                        Analyze & Extract Requirements
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </section>
            </div>

            {/* Unified Sheet */}
            <Sheet
                open={sheetState.isOpen}
                onOpenChange={(open) => setSheetState(prev => ({ ...prev, isOpen: open }))}
            >
                <SheetContent side="right" className="p-0 flex flex-col overflow-hidden sm:max-w-xl w-full" hideCloseButton>
                    {/* Custom Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-card sticky top-0 z-10 transition-all duration-300">
                        <div className="flex items-center gap-3">
                            {sheetState.view === 'recommendations' && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSheetState({ isOpen: true, view: 'analysis' })}
                                    className="h-8 w-8 -ml-2 rounded-full mr-1"
                                >
                                    <ArrowRight size={16} className="rotate-180" />
                                </Button>
                            )}

                            <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                                {sheetState.view === 'analysis' ? (
                                    <FileText size={16} className="text-brand" />
                                ) : (
                                    <Sparkle size={16} className="text-brand" />
                                )}
                            </div>
                            <div>
                                <SheetTitle className="text-lg font-semibold">
                                    {sheetState.view === 'analysis' ? 'Job Analysis' : 'Tailoring Recommendations'}
                                </SheetTitle>
                                <SheetDescription className="sr-only">
                                    View and manage job analysis details and tailoring recommendations.
                                </SheetDescription>
                                {sheetState.view === 'recommendations' && (
                                    <p className="text-xs text-muted-foreground animate-in fade-in">
                                        {recommendations.length} suggestions found
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {sheetState.view === 'recommendations' && (
                                <Button
                                    onClick={handleGenerateRecommendations}
                                    disabled={isGenerating || !jobAnalysis}
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs"
                                >
                                    <ArrowsClockwise size={14} className={`mr-1.5 ${isGenerating ? 'animate-spin' : ''}`} />
                                    Regenerate
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSheetState({ ...sheetState, isOpen: false })}
                                className="h-8 w-8 rounded-full"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Scrollable Content Area - Swappable */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-card relative">
                        {/* Analysis View */}
                        <div className={`absolute inset-0 transition-all duration-300 ${sheetState.view === 'analysis' ? 'translate-x-0 opacity-100 z-10' : '-translate-x-20 opacity-0 z-0 pointer-events-none'}`}>
                            <div className="px-6 py-6">
                                {jobAnalysis && <JobAnalysisPanel analysis={jobAnalysis} />}
                            </div>
                        </div>

                        {/* Recommendations View */}
                        <div className={`absolute inset-0 transition-all duration-300 ${sheetState.view === 'recommendations' ? 'translate-x-0 opacity-100 z-10' : 'translate-x-20 opacity-0 z-0 pointer-events-none'}`}>
                            <div className="h-full">
                                {resumeData && (
                                    <RecommendationsPanel
                                        recommendations={recommendations}
                                        resumeData={resumeData}
                                        onSaveVersion={handleSaveVersion}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sticky Footer for Analysis View */}
                    {sheetState.view === 'analysis' && (
                        <div className="border-t bg-card px-6 py-4 space-y-3 z-20">
                            {resumeData && (
                                <Button
                                    onClick={handleGenerateRecommendations}
                                    disabled={isGenerating}
                                    className="w-full h-11 text-base"
                                    size="lg"
                                >
                                    {isGenerating ? (
                                        <>
                                            <CircleNotch size={16} className="mr-2 animate-spin" />
                                            Generating Recommendations...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkle size={16} className="mr-2" />
                                            Generate Tailoring Recommendations
                                            <ArrowRight className="w-4 h-4 ml-2" />
                                        </>
                                    )}
                                </Button>
                            )}
                            <Button
                                onClick={() => {
                                    setSheetState({ ...sheetState, isOpen: false });
                                    handleAnalyzeJob();
                                }}
                                disabled={isAnalyzing}
                                variant="outline"
                                className="w-full"
                                size="sm"
                            >
                                <ArrowsClockwise size={14} className={`mr-2 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                Reanalyze Job Posting
                            </Button>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </PageLayout>
    );
}

export default function ResumeTailor() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background">
                <CircleNotch size={40} className="animate-spin text-muted-foreground/30" />
            </div>
        }>
            <ResumeTailorContent />
        </Suspense>
    );
}
