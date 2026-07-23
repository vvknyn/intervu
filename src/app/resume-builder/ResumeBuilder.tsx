"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResumeData, TailoredResumeVersion } from "@/types/resume";
import { ResumeEditor } from "@/components/resume-builder/ResumeEditor";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { SaveVersionModal } from "@/components/resume-builder/SaveVersionModal";
import { TailoredVersionsSidebar as TailoringSidebar } from "@/components/resume-builder/TailoredVersionsSidebar";
import { ArrowLeft, Sparkle, ArrowsClockwise, Check, FloppyDisk, Info, ArrowRight, SidebarSimple } from "@phosphor-icons/react";
import { fetchProfile } from "@/actions/profile";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { fetchTailoredVersions, saveTailoredVersion, SaveVersionInput } from "@/actions/tailor-resume";
import { ProviderConfig } from "@/lib/llm/types";
import { Header } from "@/components/layout/Header";
import { PageLayout } from "@/components/layout/PageLayout";
import { onAuthChange, getCurrentUser, type User } from "@/lib/firebase/client-auth";
import { useDebouncedCallback } from "use-debounce";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { SecureStorage } from "@/lib/security";
import { MotivationalBanner } from "@/components/ui/motivational-banner";
import { toast, confirmToast } from "@/lib/toast";

const INITIAL_DATA: ResumeData = {
    profile: {
        name: "",
        profession: "",
        yearsOfExperience: 0,
        location: "",
        email: "",
        phone: "",
        linkedin: "",
    },
    experience: [],
    competencies: [],
    education: [],
    generatedSummary: "",
};

const STORAGE_KEY = "interview-os-resume-data";

type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

interface ResumeBuilderProps {
    versionId?: string;
    source?: string;
    applicationId?: string;
    openTailoring?: boolean;
}

export default function ResumeBuilder({ versionId, source, applicationId, openTailoring }: ResumeBuilderProps) {
    const router = useRouter();
    const isTailoredMode = !!versionId;

    const [data, setData] = useState<ResumeData>(INITIAL_DATA);
    const [isLoaded, setIsLoaded] = useState(false);
    const [user, setUser] = useState<User | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('saved');
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [saveVersionModalOpen, setSaveVersionModalOpen] = useState(false);
    const [tailoringSidebarOpen, setTailoringSidebarOpen] = useState(openTailoring || false);
    const [versionsCount, setVersionsCount] = useState(0);
    const [originalData, setOriginalData] = useState<ResumeData | null>(null);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const pendingSaveRef = useRef<ResumeData | null>(null);

    // Listen for auth state changes
    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) setUser(currentUser);

        const unsubscribe = onAuthChange((firebaseUser) => {
            setUser(firebaseUser);
            router.refresh();
        });

        return () => {
            unsubscribe();
        };
    }, [router]);

    // Debounced save to database
    const debouncedSave = useDebouncedCallback(
        async (resumeData: ResumeData) => {
            if (!user) return;

            setSyncStatus('saving');
            const result = await saveResumeData(resumeData);

            if (result.error) {
                console.error("[ResumeBuilder] Save error:", result.error);
                setSyncStatus('error');
            } else {
                setSyncStatus('saved');
            }
        },
        1500 // 1.5 second delay
    );

    // Persist which version is being viewed (no redirect — base always loads by default)
    useEffect(() => {
        if (versionId) {
            localStorage.setItem('resume_last_viewed_version', versionId);
        } else {
            localStorage.setItem('resume_last_viewed_version', 'base');
        }
    }, [versionId]);

    useEffect(() => {
        const loadData = async () => {
            console.log("[ResumeBuilder] loadData started. VersionId:", versionId, "User:", user?.uid);

            let resumeLoaded = false;

            // Fetch tailored versions once if user is authenticated
            let versions: any[] | undefined;
            if (user) {
                console.log("[ResumeBuilder] Fetching tailored versions...");
                const versionsResult = await fetchTailoredVersions();
                versions = versionsResult.data;
                console.log("[ResumeBuilder] Fetched versions:", versions?.length);

                // Update count immediately
                if (versions) {
                    setVersionsCount(versions.length);
                }
            }

            // Priority 1: If tailored mode, load that specific version
            if (isTailoredMode && versionId && user && versions) {
                const version = versions.find(v => v.id === versionId);
                console.log("[ResumeBuilder] Tailored mode. Found version?", !!version);

                // If the requested version no longer exists, fall back to base
                if (!version) {
                    console.warn("[ResumeBuilder] Version", versionId, "not found. Falling back to base.");
                    router.replace('/resume-builder');
                    return;
                }

                if (version) {
                    // Get base data as fallback
                    const { data: baseData } = await fetchResumeData();

                    // Store original data for diff highlighting
                    // PRIORITIZE version data, fallback to base data
                    setOriginalData({
                        profile: version.originalProfile || baseData?.profile || INITIAL_DATA.profile,
                        education: version.originalEducation || baseData?.education || INITIAL_DATA.education,
                        experience: version.originalExperience || [],
                        competencies: version.originalCompetencies || [],
                        generatedSummary: version.originalSummary || "",
                        sectionOrder: version.sectionOrder || baseData?.sectionOrder,
                    });

                    // Set the active data
                    setData({
                        profile: version.originalProfile || baseData?.profile || INITIAL_DATA.profile,
                        education: version.originalEducation || baseData?.education || INITIAL_DATA.education,
                        experience: version.tailoredExperience || [],
                        competencies: version.tailoredCompetencies || [],
                        generatedSummary: version.tailoredSummary || "",
                        sectionOrder: version.sectionOrder || baseData?.sectionOrder,
                    });
                    resumeLoaded = true;
                    console.log("[ResumeBuilder] Loaded tailored version:", version.versionName, "Education entries:", version.originalEducation?.length);
                }
            }

            // Helper: check if resume data has meaningful content
            const hasContent = (d: ResumeData) =>
                !!(d.profile?.profession || d.experience?.length || d.generatedSummary);

            // Priority 2: Load from database if authenticated (and not tailored mode)
            if (!resumeLoaded && user) {
                console.log("[ResumeBuilder] Loading from DB (Base)...");
                const { data: dbData, error } = await fetchResumeData();
                if (dbData && !error && hasContent(dbData)) {
                    setData(dbData);
                    resumeLoaded = true;
                    console.log("[ResumeBuilder] Loaded from database. Profile:", dbData.profile?.profession);
                } else {
                    console.warn("[ResumeBuilder] DB data empty or failed:", error);
                }
            }

            // Priority 3: Fall back to localStorage
            if (!resumeLoaded) {
                console.log("[ResumeBuilder] checking localStorage...");
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        if (hasContent(parsed)) {
                            setData(parsed);
                            resumeLoaded = true;
                            console.log("[ResumeBuilder] Loaded from localStorage");

                            // If user is authenticated, migrate localStorage to DB
                            if (user) {
                                console.log("[ResumeBuilder] Migrating localStorage to DB...");
                                setSyncStatus('saving');
                                await saveResumeData(parsed);
                                setSyncStatus('saved');
                            }
                        }
                    } catch (e) {
                        console.error("Failed to parse saved resume data", e);
                    }
                } else {
                    console.log("[ResumeBuilder] No data in localStorage");
                }
            }

            // Priority 4: If still nothing loaded and there are tailored versions, redirect to the first one
            if (!resumeLoaded && versions && versions.length > 0) {
                console.log("[ResumeBuilder] No base data found. Redirecting to first available version:", versions[0].id);
                router.replace(`/resume-builder?versionId=${versions[0].id}`);
                return;
            }

            // Set sync status based on auth
            if (!user) {
                setSyncStatus('offline');
            }

            setIsLoaded(true);
        };
        loadData();
    }, [versionId, isTailoredMode, user?.uid]);

    // Save to localStorage always, and debounce save to DB if authenticated
    // IMPORTANT: Do NOT save to DB when viewing a tailored version - that would overwrite the base resume
    useEffect(() => {
        if (isLoaded) {
            // Only save to localStorage when NOT in tailored mode
            // (In tailored mode, we don't want to overwrite the base resume in localStorage either)
            if (!isTailoredMode) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

                // If authenticated, also save to database (debounced)
                if (user) {
                    setSyncStatus('saving');
                    debouncedSave(data);
                }
            } else {
                // In tailored mode, just show saved status (changes are to the tailored version, not base)
                setSyncStatus('saved');
            }
        }
    }, [data, isLoaded, user, debouncedSave, isTailoredMode]);

    // Listen for version updates (deletions, creates) and refresh count + handle navigation
    useEffect(() => {
        const handleVersionUpdate = async () => {
            const { data: versions } = await fetchTailoredVersions();

            if (versions) {
                // Update the count
                setVersionsCount(versions.length);

                // If we're viewing a version that no longer exists, navigate
                if (isTailoredMode && versionId) {
                    const currentVersionExists = versions.some(v => v.id === versionId);

                    if (!currentVersionExists) {
                        // Current version was deleted - navigate to next available or base
                        if (versions.length > 0) {
                            // Navigate to the first available version
                            router.push(`/resume-builder?versionId=${versions[0].id}`);
                        } else {
                            // No versions left - go to base resume
                            router.push('/resume-builder');
                        }
                    }
                }
            }
        };

        window.addEventListener('version-updated', handleVersionUpdate);
        return () => window.removeEventListener('version-updated', handleVersionUpdate);
    }, [isTailoredMode, versionId, router]);

    const updateData = useCallback((partialData: Partial<ResumeData>) => {
        setData((prev) => ({ ...prev, ...partialData }));
    }, []);

    const clearData = () => {
        setClearConfirmOpen(true);
    };

    const confirmClear = async () => {
        // Clear data completely
        setData(INITIAL_DATA);
        setOriginalData(null);

        // Clear localStorage
        localStorage.removeItem(STORAGE_KEY);

        // Clear database if authenticated
        if (user) {
            setSyncStatus('saving');
            try {
                await saveResumeData(INITIAL_DATA);
                setSyncStatus('saved');
            } catch (err) {
                console.error("Failed to clear database resume:", err);
                setSyncStatus('error');
            }
        }

        // If in tailored mode, navigate to base resume
        if (isTailoredMode) {
            router.push('/resume-builder');
        }

        setClearConfirmOpen(false);
        console.log("[ResumeBuilder] Resume data cleared");
    };

    const handleImport = useCallback((importedData: ResumeData, importSource: 'pdf' | 'docx' | 'text', confidence: number) => {
        setData(importedData);

        // Save with import metadata
        if (user) {
            setSyncStatus('saving');
            saveResumeData(importedData, importSource, confidence).then(() => {
                setSyncStatus('saved');
            });
        }

        // Auto-open tailoring sidebar after import when in wizard flow
        if (applicationId && (source === 'applications' || source === 'new-application')) {
            setTailoringSidebarOpen(true);
        }
    }, [user, applicationId, source]);

    // Save a snapshot version of the current resume
    const handleSaveVersion = useCallback(async (version: SaveVersionInput) => {
        if (!user) {
            throw new Error("Must be signed in to save versions");
        }

        const result = await saveTailoredVersion(version);

        if (result.error) {
            throw new Error(result.error);
        }

        // Refresh versions count and dispatch event for sidebar to refresh
        const { data: versions } = await fetchTailoredVersions();
        if (versions) {
            setVersionsCount(versions.length);
        }

        // Dispatch event to refresh sidebar
        window.dispatchEvent(new CustomEvent('version-updated'));

        console.log("[ResumeBuilder] Version saved:", version.versionName);
    }, [user]);

    // State for "Make Base" feature
    const [isMakingBase, setIsMakingBase] = useState(false);
    const [madeBase, setMadeBase] = useState(false);

    const handleMakeBase = async () => {
        if (!user || !isTailoredMode) return;

        const confirmed = await confirmToast({
            title: "Replace base resume?",
            description:
                "This will copy the current tailored version to your base resume. Your original base resume will be replaced.",
            confirmLabel: "Replace",
            destructive: true,
        });

        if (!confirmed) return;

        setIsMakingBase(true);
        try {
            // Save current data as the base resume
            const result = await saveResumeData(data);

            if (result.error) {
                toast.error("Failed to update base resume: " + result.error);
            } else {
                setMadeBase(true);
                // Show success briefly then redirect
                setTimeout(() => {
                    router.push('/resume-builder');
                }, 1500);
            }
        } catch (err) {
            console.error("Error making base:", err);
            toast.error("Failed to update base resume");
        } finally {
            setIsMakingBase(false);
        }
    };

    if (!isLoaded) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <PageLayout
            fullWidth
            header={
                <Header
                    user={user}
                    showSearch={false}
                    title="Resume Builder"
                    backButton={
                        (source === 'applications' || source === 'new-application') ? (
                            <Link href="/yours">
                                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                                    <ArrowLeft size={16} />
                                    <span className="hidden sm:inline">Back to Yours</span>
                                    <span className="sm:hidden">Back</span>
                                </Button>
                            </Link>
                        ) : undefined
                    }
                />
            }
        >
            <div className="px-4 sm:px-6 pt-4">
                <MotivationalBanner />
            </div>

            {isTailoredMode && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
                    <span className="font-medium text-amber-900 dark:text-amber-200 text-xs sm:text-sm">📋 Tailored Version</span>
                    <span className="text-amber-300 hidden sm:inline">|</span>
                    <Link href="/resume-builder" className="hover:underline flex items-center text-amber-700 dark:text-amber-300 text-xs sm:text-sm">
                        <ArrowLeft className="mr-1" size={14} />
                        Back to Standard
                    </Link>
                    <span className="text-amber-300 hidden sm:inline">|</span>
                    <button
                        onClick={handleMakeBase}
                        disabled={isMakingBase || madeBase}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium text-xs sm:text-sm transition-all ${madeBase
                            ? 'bg-green-500 text-white'
                            : 'bg-amber-600 text-white hover:bg-amber-700'
                            } disabled:opacity-70`}
                    >
                        {madeBase ? (
                            <>
                                <Check size={14} weight="bold" />
                                Done!
                            </>
                        ) : isMakingBase ? (
                            <>
                                <ArrowsClockwise size={14} className="animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <ArrowsClockwise size={14} weight="bold" />
                                <span className="hidden sm:inline">Make This My Base Resume</span>
                                <span className="sm:hidden">Make Base</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Wizard Flow Context Banner */}
            {source === 'applications' && applicationId && !isTailoredMode && (
                <div className="bg-brand/5 border-b border-brand/20 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex items-center gap-3 min-w-0">
                            <Info size={18} weight="duotone" className="text-brand shrink-0" />
                            <p className="text-sm font-medium text-foreground">Tailor your resume for this application</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {!tailoringSidebarOpen && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={() => setTailoringSidebarOpen(true)}
                                >
                                    <SidebarSimple size={14} weight="duotone" />
                                    Open Sidebar
                                </Button>
                            )}
                            <Link href="/yours" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                                Skip & Return
                                <ArrowRight size={12} />
                            </Link>
                        </div>
                    </div>
                    {/* Step progress indicators */}
                    <div className="flex items-center gap-2 mt-2.5 text-xs flex-wrap">
                        {/* Step 1: Upload resume */}
                        <div className={`flex items-center gap-1.5 ${(data.profile?.profession || data.experience?.length || data.generatedSummary) ? 'text-green-600 dark:text-green-400' : 'text-foreground font-medium'}`}>
                            {(data.profile?.profession || data.experience?.length || data.generatedSummary) ? (
                                <span className="w-4.5 h-4.5 rounded-full bg-green-500 text-white flex items-center justify-center">
                                    <Check size={10} weight="bold" />
                                </span>
                            ) : (
                                <span className="w-4.5 h-4.5 rounded-full bg-brand text-white flex items-center justify-center text-[10px] font-bold">1</span>
                            )}
                            <span>Upload resume</span>
                        </div>
                        <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
                        {/* Step 2: Open sidebar & paste job posting */}
                        <div className={`flex items-center gap-1.5 ${tailoringSidebarOpen ? 'text-brand font-medium' : 'text-muted-foreground'}`}>
                            <span className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold ${tailoringSidebarOpen ? 'bg-brand text-white' : 'bg-muted-foreground/20 text-muted-foreground'}`}>2</span>
                            <span>Paste job posting</span>
                        </div>
                        <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
                        {/* Step 3: Save tailored version */}
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="w-4.5 h-4.5 rounded-full bg-muted-foreground/20 text-muted-foreground flex items-center justify-center text-[10px] font-bold">3</span>
                            <span>Save tailored version</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Editor */}
            <div data-tour="resume-editor">
                <ResumeEditor
                    data={data}
                    onUpdate={updateData}
                    onClear={clearData}
                    onImport={() => {
                        if (user) {
                            setImportModalOpen(true);
                        } else {
                            setAuthPopoverOpen(true);
                        }
                    }}
                    syncStatus={syncStatus}
                    originalData={originalData} // Pass for diff highlighting
                    isTailoredMode={isTailoredMode}
                    versionsToggle={
                        <div className="flex items-center gap-2">
                            {/* Save Version Button */}
                            <button
                                data-tour="resume-import"
                                onClick={() => {
                                    if (user) {
                                        setSaveVersionModalOpen(true);
                                    } else {
                                        setAuthPopoverOpen(true);
                                    }
                                }}
                                className="group inline-flex items-center h-8 px-2.5 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-all duration-200"
                                title={user ? "Save current resume as a version" : "Sign in to save versions"}
                            >
                                <FloppyDisk size={15} weight="fill" className="text-muted-foreground group-hover:text-brand shrink-0 transition-colors" />
                                <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                    <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">
                                        Save
                                    </span>
                                </span>
                            </button>

                            {/* Tailor Resume / View Versions Button */}
                            <button
                                data-tour="resume-tailor"
                                onClick={() => {
                                    if (user) {
                                        setTailoringSidebarOpen(true);
                                    } else {
                                        setAuthPopoverOpen(true);
                                    }
                                }}
                                className="group inline-flex items-center h-8 px-2.5 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-all duration-200"
                                title={user ? "Tailor resume to a job description" : "Sign in to tailor resume"}
                            >
                                <Sparkle size={15} weight="fill" className="text-brand shrink-0" />
                                <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                                    <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">
                                        {versionsCount > 0 ? "Versions" : "Tailor"}
                                    </span>
                                </span>
                                {versionsCount > 0 && user && (
                                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-brand/10 text-brand text-xs font-semibold">
                                        {versionsCount}
                                    </span>
                                )}
                            </button>
                        </div>
                    }
                />
            </div>

            {/* Import Modal */}
            <ResumeImportModal
                isOpen={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onImport={handleImport}
            />

            {/* Save Version Modal */}
            <SaveVersionModal
                open={saveVersionModalOpen}
                onOpenChange={setSaveVersionModalOpen}
                resumeData={data}
                onSave={handleSaveVersion}
            />

            {/* Clear Confirmation Dialog */}
            <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                <DialogContent className="sm:max-w-md bg-white">
                    <DialogHeader>
                        <DialogTitle>Clear All Resume Data?</DialogTitle>
                        <DialogDescription>
                            This will permanently delete all your resume content including your name, experience, education, skills, and summary. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setClearConfirmOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmClear}
                        >
                            Clear Resume
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Darkened Backdrop */}
            {tailoringSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-[55] animate-in fade-in duration-300"
                    onClick={() => setTailoringSidebarOpen(false)}
                />
            )}

            {/* Tailoring Sidebar */}
            <TailoringSidebar
                isOpen={tailoringSidebarOpen}
                onClose={() => setTailoringSidebarOpen(false)}
                currentVersionId={versionId}
                applicationId={applicationId}
                isNewApplication={source === 'new-application'}
            />

            {/* Auth Popover for guest users trying to access protected features */}
            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
            />
        </PageLayout>
    );
}
