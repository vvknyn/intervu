"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResumeData, TailoredResumeVersion } from "@/types/resume";
import { ResumeEditor } from "@/components/resume-builder/ResumeEditor";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { SaveVersionModal } from "@/components/resume-builder/SaveVersionModal";
import { TailoredVersionsSidebar as TailoringSidebar } from "@/components/resume-builder/TailoredVersionsSidebar";
import { VersionCardsRow } from "@/components/resume-builder/VersionCardsRow";
import { TailoringSidebarCard } from "@/components/resume-builder/TailoringSidebarCard";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { fetchTailoredVersions, saveTailoredVersion, SaveVersionInput } from "@/actions/tailor-resume";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { onAuthChange, getCurrentUser, type User } from "@/lib/firebase/client-auth";
import { useDebouncedCallback } from "use-debounce";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { MotivationalBanner } from "@/components/ui/motivational-banner";
import { toast, confirmToast } from "@/lib/toast";
import { printResume } from "@/lib/resume/print-resume";
import { hasResumeContent } from "@/lib/resume/has-content";

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
    // Single source of truth for both the version count (versionsToggle badge)
    // and the version cards row / tailoring sidebar (hub layout) — those need
    // the real names/timestamps/recommendations, not just a count.
    const [versions, setVersions] = useState<TailoredResumeVersion[]>([]);
    const [originalData, setOriginalData] = useState<ResumeData | null>(null);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);

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
            let versions: TailoredResumeVersion[] | undefined;
            if (user) {
                console.log("[ResumeBuilder] Fetching tailored versions...");
                const versionsResult = await fetchTailoredVersions();
                versions = versionsResult.data;
                console.log("[ResumeBuilder] Fetched versions:", versions?.length);

                // Update immediately
                setVersions(versions ?? []);
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

            // Priority 2: Load from database if authenticated (and not tailored mode)
            if (!resumeLoaded && user) {
                console.log("[ResumeBuilder] Loading from DB (Base)...");
                const { data: dbData, error } = await fetchResumeData();
                if (dbData && !error && hasResumeContent(dbData)) {
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
                        if (hasResumeContent(parsed)) {
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
                setVersions(versions);

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

        // Refresh versions and dispatch event for sidebar to refresh
        const { data: versions } = await fetchTailoredVersions();
        if (versions) {
            setVersions(versions);
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
            <PageLayout fullWidth>
                <p className="px-4 py-8 font-mono text-[13px] text-muted-foreground sm:px-6">Loading your resume…</p>
            </PageLayout>
        );
    }

    // The version currently being viewed, for the sidebar's Tailoring card —
    // undefined both when the base resume is active and when the requested
    // version hasn't loaded (or was deleted) yet.
    const selectedVersion = isTailoredMode ? versions.find((v) => v.id === versionId) : undefined;
    const versionCount = versions.length + 1; // +1 for the base resume

    return (
        <PageLayout fullWidth>
            <div className="px-4 sm:px-6 pt-4">
                <MotivationalBanner />
            </div>

            {/* Tailored-version notice — editorial pass: a ruled band in
                verdict-caution ink (this IS the "worth verifying before you
                treat it as your default" signal), text actions instead of
                pill buttons, no emoji. */}
            {isTailoredMode && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border bg-verdict-caution-bg px-4 py-2 font-mono text-[12px] text-verdict-caution sm:px-6">
                    <span className="font-medium uppercase tracking-[0.06em]">Tailored version</span>
                    <div className="flex items-center gap-4">
                        <Link href="/resume-builder" className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground">
                            ← back to base
                        </Link>
                        <button
                            onClick={handleMakeBase}
                            disabled={isMakingBase || madeBase}
                            className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground disabled:opacity-60"
                        >
                            {madeBase ? "done — now your base" : isMakingBase ? "saving…" : "make this my base"}
                        </button>
                    </div>
                </div>
            )}

            {/* Wizard Flow Context Banner — editorial pass: a ruled band (no
                tinted panel), actions as underlined text, steps as a plain
                mono sequence with the in-progress step in ink and the rest
                muted (same shape as TailoringSidebarCard/VersionCardsRow). */}
            {source === 'applications' && applicationId && !isTailoredMode && (
                <div className="border-y border-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <p className="text-[13px] font-medium text-foreground">Tailor your resume for this application</p>
                        <div className="flex items-center gap-4 shrink-0">
                            {!tailoringSidebarOpen && (
                                <button
                                    onClick={() => setTailoringSidebarOpen(true)}
                                    className="font-mono text-[12px] text-foreground underline underline-offset-2 transition-colors duration-100 hover:opacity-70"
                                >
                                    open sidebar
                                </button>
                            )}
                            <Link
                                href="/yours"
                                className="font-mono text-[12px] text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                            >
                                skip &amp; return
                            </Link>
                        </div>
                    </div>
                    {/* Step sequence: 1 done once real resume data exists, 2
                        current only once the sidebar is open, 3 always
                        pending — same completion checks as before, restyled. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px]">
                        {[
                            { label: "upload resume", done: Boolean(data.profile?.profession || data.experience?.length || data.generatedSummary), current: false },
                            { label: "paste job posting", done: false, current: tailoringSidebarOpen },
                            { label: "save tailored version", done: false, current: false },
                        ].map((step, i, steps) => (
                            <span key={step.label} className="flex items-center gap-1.5">
                                <span className={step.done || step.current ? "text-foreground" : "text-muted-foreground"}>
                                    {step.done ? "✓" : i + 1} {step.label}
                                </span>
                                {i < steps.length - 1 && <span className="text-muted-foreground/50">·</span>}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Resume hub: header + version cards + paper preview, with a
                persistent Tailoring sidebar — PORTAL-REDESIGN-SPEC.md, Page:
                Resume. The editor/preview itself keeps its existing split-pane
                logic (ResumeEditor internals untouched); this just frames it. */}
            <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-7 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[1fr_350px] lg:px-14">
                <div className="min-w-0">
                    <div className="mb-[18px]">
                        <PageHeader
                            bare
                            size="display"
                            title="Resume"
                            description={`${versionCount} version${versionCount === 1 ? "" : "s"}`}
                            actions={<Button onClick={printResume}>Export PDF</Button>}
                        />
                        {!hasResumeContent(data) && (
                            <p className="mt-3 text-[13px] text-muted-foreground" data-testid="resume-empty-hint">
                                Nothing here yet — add your name and most recent role to get started, or{" "}
                                <button
                                    type="button"
                                    onClick={() => (user ? setImportModalOpen(true) : setAuthPopoverOpen(true))}
                                    className="text-foreground underline underline-offset-2 transition-colors duration-100 hover:opacity-70"
                                >
                                    import an existing resume
                                </button>
                                .
                            </p>
                        )}
                    </div>

                    <VersionCardsRow versions={versions} activeVersionId={versionId} />

                    <div data-tour="resume-editor" className="border-t border-border pt-5">
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
                                <>
                                    <Button
                                        data-tour="resume-import"
                                        variant="quiet"
                                        size="sm"
                                        onClick={() => {
                                            if (user) {
                                                setSaveVersionModalOpen(true);
                                            } else {
                                                setAuthPopoverOpen(true);
                                            }
                                        }}
                                        className="hidden sm:inline-flex"
                                        title={user ? "Save current resume as a version" : "Sign in to save versions"}
                                    >
                                        Save
                                    </Button>

                                    <Button
                                        data-tour="resume-tailor"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            if (user) {
                                                setTailoringSidebarOpen(true);
                                            } else {
                                                setAuthPopoverOpen(true);
                                            }
                                        }}
                                        title={user ? "Tailor resume to a job description" : "Sign in to tailor resume"}
                                    >
                                        {versions.length > 0 ? `Versions (${versions.length})` : "Tailor"}
                                    </Button>
                                </>
                            }
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <TailoringSidebarCard version={selectedVersion} />
                </div>
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
