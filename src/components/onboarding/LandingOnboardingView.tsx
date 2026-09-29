"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { getMarketingStatsAction } from "@/actions/marketing";
import { formatCorpusCount, formatCompactCorpusCount } from "@/lib/jobs/corpus-count";
import {
    Sparkle,
    ArrowRight,
    ArrowLeft,
    Check,
    UploadSimple,
    Cpu,
    ShieldCheck,
    CloudCheck,
    HardDrive,
    User,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { initLocalAiLadder } from "@/lib/local-ai/ladder";
import {
    parseResumeFileForReview,
    PROFILE_REVIEW_UNREADABLE_ERROR,
} from "@/lib/resume/profile-review-parse";
import { buildReturnTo } from "@/lib/jobs/pending-actions";
import {
    LANDING_DEVICE_STORAGE_NOTE,
    LANDING_PROFILE_PRIVACY_NOTE,
    LANDING_UPLOAD_PRIVACY_NOTE,
} from "@/lib/jobs/resume-privacy-copy";
import type { ResumeData, ResumeProfile } from "@/types/resume";
import { OnboardingStepLabel } from "@/components/onboarding/onboarding-step-label";

export interface LandingOnboardingViewProps {
    onComplete: (data: {
        resume: ResumeData | null;
        storageMode: "cloud" | "device";
        accountCreated: boolean;
    }) => void;
    onSkip?: () => void;
    onOpenAuth?: () => void;
    /** Soft-gate: open public Advanced search (not For-you packs). */
    onBrowsePublicJobs?: () => void;
    isAuthenticated?: boolean;
    initialStep?: 2 | 3;
    initialParsedResume?: ResumeData | null;
    userEmail?: string | null;
    userName?: string | null;
    className?: string;
}

export function LandingOnboardingView({
    onComplete,
    onSkip,
    onOpenAuth,
    onBrowsePublicJobs,
    isAuthenticated = false,
    initialStep,
    initialParsedResume,
    userEmail,
    userName,
    className,
}: LandingOnboardingViewProps) {
    const [step, setStep] = useState<2 | 3>(initialStep ?? (isAuthenticated ? 3 : 2));
    const [modelReady, setModelReady] = useState(false);
    const [storageMode, setStorageMode] = useState<"cloud" | "device">("cloud");
    const [uploading, setUploading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [parsedResume, setParsedResume] = useState<ResumeData | null>(initialParsedResume ?? null);
    const [skillsString, setSkillsString] = useState<string>(() => {
        if (!initialParsedResume?.competencies) return "";
        return initialParsedResume.competencies.flatMap((c) => c.skills).join(", ");
    });
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [liveRoleCount, setLiveRoleCount] = useState<string>("2.4M+");
    const [compactLiveRoleCount, setCompactLiveRoleCount] = useState<string>("~2.4M");

    const fileInputRef = useRef<HTMLInputElement>(null);
    const step2Ref = useRef<HTMLDivElement>(null);

    const redirectToAuthStart = (mode: "login" | "signup", provider?: string) => {
        const params = new URLSearchParams();
        const next = typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("next") || buildReturnTo(window.location)
            : "/jobs";
        if (next) params.set("next", next);
        params.set("mode", mode);
        if (provider) params.set("provider", provider);
        const query = params.toString();
        window.location.href = `/auth/start${query ? `?${query}` : ""}`; // signup-gate-exempt: onboarding step that is the account-creation flow itself
    };

    const handleStartAuth = (provider?: string) => {
        redirectToAuthStart("signup", provider);
    };

    const handleSignIn = () => {
        redirectToAuthStart("login");
    };

    // Auto-advance to Step 3 if user authenticates while on Step 2
    useEffect(() => {
        if (isAuthenticated && step === 2) {
            setStep(3);
        }
    }, [isAuthenticated, step]);

    // Settle Step 2 into the viewport.
    // Double rAF waits for layout after body overflow unlock + card mount
    // (real iPhone Safari can otherwise flash empty light-grey chrome).
    useEffect(() => {
        if (step !== 2) return;
        let cancelled = false;
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (cancelled) return;
                step2Ref.current?.scrollIntoView({ block: "center", inline: "nearest" });
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(id);
        };
    }, [step]);

    // Fetch live market role counts from Meilisearch.
    useEffect(() => {
        let mounted = true;
        getMarketingStatsAction()
            .then((stats) => {
                if (mounted && stats?.liveJobs) {
                    setLiveRoleCount(formatCorpusCount(stats.liveJobs));
                    setCompactLiveRoleCount(formatCompactCorpusCount(stats.liveJobs));
                }
            })
            .catch(() => {});
        return () => {
            mounted = false;
        };
    }, [step]);

    // Silent background pre-warm of the local-ai ladder.
    useEffect(() => {
        let mounted = true;
        const prewarm = async () => {
            try {
                await initLocalAiLadder();
                if (mounted) setModelReady(true);
            } catch {
                if (mounted) setModelReady(true);
            }
        };
        void prewarm();
        return () => {
            mounted = false;
        };
    }, [step]);

    const updateProfileField = (field: keyof ResumeProfile, val: string | number) => {
        setParsedResume((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                profile: {
                    ...prev.profile,
                    [field]: val,
                },
            };
        });
    };

    const updateSkills = (val: string) => {
        const list = val.split(",").map((s) => s.trim()).filter(Boolean);
        setParsedResume((prev) => {
            if (!prev) return prev;
            const comps =
                prev.competencies && prev.competencies.length > 0
                    ? [...prev.competencies]
                    : [{ category: "Core Skills", skills: [] }];
            comps[0] = {
                category: comps[0].category || "Core Skills",
                skills: list,
            };
            return {
                ...prev,
                competencies: comps,
            };
        });
    };

    const handleFileSelected = async (file: File) => {
        setUploadError(null);
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["pdf", "docx", "doc"].includes(extension)) {
            setUploadError("Please upload a PDF or DOCX résumé, or paste your text below.");
            return;
        }

        setUploadedFile(file);
        setParsedResume(null);
        setSkillsString("");
        setUploading(true);

        try {
            const outcome = await parseResumeFileForReview(file);
            if (!outcome.ok) {
                setUploadError(outcome.error);
                return;
            }
            setParsedResume(outcome.parsed);
            setSkillsString(outcome.skillsString);
        } catch {
            setParsedResume(null);
            setSkillsString("");
            setUploadError(PROFILE_REVIEW_UNREADABLE_ERROR);
        } finally {
            setUploading(false);
        }
    };

    const handleFinalSubmit = () => {
        onComplete({
            resume: parsedResume,
            storageMode,
            accountCreated: isAuthenticated,
        });
    };

    // Pre-account sign-in — not an onboarding step (no progress chrome).
    if (step === 2 && !isAuthenticated) {
        return (
            <div className={cn("relative z-10 mx-auto w-full max-w-[440px]", className)}>
                <div
                    ref={step2Ref}
                    data-testid="landing-onboarding-step-2"
                    className="space-y-6 rounded-panel border border-border bg-card p-6 shadow-[var(--shadow-bevel-highlight)] sm:p-8"
                >
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
                            {/* signup-gate-exempt: onboarding step that is the account-creation flow itself */}Create your free account
                        </h2>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            {/* signup-gate-exempt: onboarding step that is the account-creation flow itself */}Sign in to save matches, tailored résumés, and applications to your private Velai profile.
                        </p>
                    </div>

                    <div className="space-y-3">
                        <Button
                            type="button"
                            size="lg"
                            className="w-full gap-2.5 text-sm font-semibold"
                            onClick={() => redirectToAuthStart("login", "GoogleOAuth")}
                        >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                            </svg>
                            Continue with Google
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="w-full text-sm font-semibold"
                            onClick={() => redirectToAuthStart("login")}
                        >
                            Continue with email
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const resumeOnboardingStep = step === 2 ? 1 : 2;

    return (
        <div className={cn(
            "mx-auto w-full relative z-10 max-w-[760px]",
            className,
        )}>
            {/* Post-account onboarding (résumé gate) */}
            <div className="relative z-10 space-y-3 rounded-panel border border-border bg-surface p-3.5 shadow-[var(--shadow-bevel-highlight)] sm:p-5">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 rounded-pill bg-live" />
                        <span className="font-semibold text-foreground">Getting started</span>
                        <span className="text-muted-foreground">·</span>
                        <OnboardingStepLabel step={resumeOnboardingStep} total={2} />
                    </div>
                    <span className="max-w-[130px] truncate text-xs font-semibold text-muted-foreground sm:max-w-none">
                        {userName || userEmail || "Account"} ✓
                    </span>
                </div>

                <div className="grid w-full grid-cols-2 gap-1.5">
                    <div className={cn("h-1 rounded-pill transition-colors duration-200", resumeOnboardingStep >= 1 ? "bg-live" : "bg-muted")} />
                    <div className={cn("h-1 rounded-pill transition-colors duration-200", resumeOnboardingStep >= 2 ? "bg-live" : "bg-muted")} />
                </div>

                {step === 2 && isAuthenticated && (
                    <div
                        ref={step2Ref}
                        data-testid="landing-onboarding-step-2"
                        className="space-y-3.5"
                    >
                        <div className="space-y-1">
                            <h2 className="text-lg font-semibold text-foreground sm:text-xl">Account connected</h2>
                            <p className="text-xs text-muted-foreground">
                                Your account is verified. Upload your résumé next for private matching.
                            </p>
                        </div>

                        <div className="space-y-1.5 rounded-ctl border border-border bg-muted p-3 text-xs">
                            <div className="flex items-center gap-2 text-live">
                                <Check size={16} />
                                <span className="font-semibold text-foreground">
                                    Signed in as {userName || userEmail || "your account"}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-end border-t border-border pt-2">
                            <Button
                                size="sm"
                                onClick={() => setStep(3)}
                                className="gap-1.5 text-xs font-semibold"
                            >
                                Next: Upload résumé <ArrowRight size={16} />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STATION 3: RÉSUMÉ UPLOAD & PROFILE PARAMETERS */}
                {step === 3 && (
                    <div className="space-y-3">
                        <div className="space-y-0.5">
                            <h2 className="text-base sm:text-lg font-semibold text-foreground">
                                {parsedResume ? "Review your profile details" : "Add your résumé"}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                {parsedResume
                                    ? "We pulled these details from your résumé. You can adjust anything here to fine-tune your job matches."
                                    : "Upload your résumé to immediately see matching roles tailored to your background."}
                            </p>
                        </div>

                        {parsedResume ? (
                            /* User Profile Parameters Section */
                            <div className="space-y-2.5">
                                {/* Compact File Status Banner */}
                                <div className="flex items-center justify-between px-3 py-1.5 rounded-ctl border border-border bg-muted text-xs">
                                    <div className="flex items-center gap-2 text-foreground font-semibold">
                                        <Check size={16} className="text-live shrink-0" />
                                        <span className="truncate max-w-[200px] sm:max-w-xs">{uploadedFile?.name || "Uploaded résumé"}</span>
                                        <span className="text-live font-normal hidden sm:inline">— Parsed on-device</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setUploadedFile(null);
                                            setParsedResume(null);
                                            setSkillsString("");
                                            fileInputRef.current?.click();
                                        }}
                                        className="text-xs text-muted-foreground underline hover:text-foreground shrink-0"
                                    >
                                        Upload different file
                                    </button>
                                </div>

                                {/* Form Grid */}
                                <div className="rounded-panel border border-border bg-card p-3 sm:p-3.5 space-y-2.5">
                                    <div className="flex items-center justify-between pb-1.5 border-b border-border">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <User size={16} className="text-brand shrink-0" />
                                            <span>Your Profile Details</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground">Adjust to fine-tune your matches</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-foreground">Full Name</Label>
                                            <Input
                                                value={parsedResume.profile.name || ""}
                                                onChange={(e) => updateProfileField("name", e.target.value)}
                                                placeholder="Your Name"
                                                className="ctl-md text-xs rounded-ctl"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-foreground">Target Job Title</Label>
                                            <Input
                                                value={parsedResume.profile.profession || ""}
                                                onChange={(e) => updateProfileField("profession", e.target.value)}
                                                placeholder="e.g. Senior Software Engineer"
                                                className="ctl-md text-xs rounded-ctl"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-foreground">Years of Experience</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={50}
                                                value={parsedResume.profile.yearsOfExperience || 0}
                                                onChange={(e) => updateProfileField("yearsOfExperience", parseInt(e.target.value, 10) || 0)}
                                                className="ctl-md text-xs rounded-ctl"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-foreground">Preferred Location</Label>
                                            <Input
                                                value={parsedResume.profile.location || ""}
                                                onChange={(e) => updateProfileField("location", e.target.value)}
                                                placeholder="e.g. San Francisco, CA or Remote"
                                                className="ctl-md text-xs rounded-ctl"
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs text-foreground">Core Skills (comma separated)</Label>
                                            <Input
                                                value={skillsString}
                                                onChange={(e) => {
                                                    setSkillsString(e.target.value);
                                                    updateSkills(e.target.value);
                                                }}
                                                placeholder="e.g. TypeScript, React, Next.js, Python, SQL"
                                                className="ctl-md text-xs rounded-ctl"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Privacy Note */}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-ctl border border-border bg-muted">
                                    <ShieldCheck size={16} className="text-live shrink-0" />
                                    <span>{LANDING_PROFILE_PRIVACY_NOTE}</span>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center justify-between pt-1.5 border-t border-border">
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        onClick={() => setStep(2)}
                                        className="gap-1.5 text-xs"
                                    >
                                        <ArrowLeft size={16} /> Back
                                    </Button>

                                    <Button
                                        size="sm"
                                        onClick={handleFinalSubmit}
                                        className="gap-1.5 text-xs font-semibold"
                                    >
                                        <Sparkle size={16} />
                                        Save &amp; Start matching roles
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            /* Pre-upload dropzone and storage selector */
                            <div className="space-y-3">
                                {/* Storage Choice */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Where should your résumé be saved?
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setStorageMode("cloud")}
                                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStorageMode("cloud")}
                                            className={cn(
                                                "p-2.5 rounded-ctl border transition-all cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                                storageMode === "cloud"
                                                    ? "border-brand bg-card ring-1 ring-brand"
                                                    : "border-border bg-card hover:border-foreground",
                                            )}
                                        >
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <CloudCheck size={16} className="text-brand shrink-0" />
                                                <span className="text-xs font-semibold text-foreground">
                                                    Save to my account
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-snug">
                                                Follows you when you sign in from your phone or another computer.
                                            </p>
                                        </div>

                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setStorageMode("device")}
                                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStorageMode("device")}
                                            className={cn(
                                                "p-2.5 rounded-ctl border transition-all cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                                storageMode === "device"
                                                    ? "border-brand bg-card ring-1 ring-brand"
                                                    : "border-border bg-card hover:border-foreground",
                                            )}
                                        >
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <HardDrive size={16} className="text-brand shrink-0" />
                                                <span className="text-xs font-semibold text-foreground">
                                                    Keep only on this computer
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-snug">
                                                {LANDING_DEVICE_STORAGE_NOTE}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Upload Drop Zone */}
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed rounded-panel p-4 sm:p-5 text-center cursor-pointer transition-colors bg-card border-border hover:border-foreground active:scale-[0.99]"
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf,.docx,.doc"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) void handleFileSelected(file);
                                        }}
                                    />

                                    {uploading ? (
                                        <div className="flex flex-col items-center gap-1.5">
                                            <Cpu size={20} className="animate-spin text-brand" />
                                            <p className="text-xs font-semibold text-foreground">
                                                Private assistant parsing résumé locally…
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Extracting profile parameters on this device
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-ctl bg-muted text-muted-foreground">
                                                <UploadSimple size={20} />
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-foreground">
                                                    Tap to select or drag and drop your résumé
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    PDF or DOCX up to 10MB
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {uploadError && (
                                    <p className="text-xs text-destructive">{uploadError}</p>
                                )}

                                {/* Privacy Guarantee Note */}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-ctl border border-border bg-muted">
                                    <ShieldCheck size={16} className="text-live shrink-0" />
                                    <span>{LANDING_UPLOAD_PRIVACY_NOTE}</span>
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t border-border">
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        onClick={() => setStep(2)}
                                        className="gap-1.5 text-xs"
                                    >
                                        <ArrowLeft size={16} /> Back
                                    </Button>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleFinalSubmit}
                                            className="text-xs"
                                        >
                                            Browse without résumé
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
