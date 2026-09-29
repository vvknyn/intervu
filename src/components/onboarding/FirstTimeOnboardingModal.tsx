"use client";

import { useState, useRef, useEffect } from "react";
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
    FilePdf,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { OnboardingStepLabel } from "@/components/onboarding/onboarding-step-label";
import { parseResumeFileForReview, PROFILE_REVIEW_UNREADABLE_ERROR } from "@/lib/resume/profile-review-parse";
import {
    ONBOARDING_MATCHING_PRIVACY,
    ONBOARDING_UPLOAD_PRIVACY_BODY,
    ONBOARDING_UPLOAD_PRIVACY_LABEL,
} from "@/lib/jobs/resume-privacy-copy";
import { initLocalAiLadder } from "@/lib/local-ai/ladder";
import type { ResumeData } from "@/types/resume";

export interface FirstTimeOnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onComplete: (data: {
        resume: ResumeData | null;
        storageMode: "cloud" | "device";
        accountCreated: boolean;
    }) => void;
    onOpenAuth?: () => void;
}

export function FirstTimeOnboardingModal({
    isOpen,
    onClose,
    onComplete,
    onOpenAuth,
}: FirstTimeOnboardingModalProps) {
    // 3-step sequence: 1 = How it works, 2 = Create Account, 3 = Upload Résumé & Storage
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Silent background prewarm state
    const [modelReady, setModelReady] = useState(false);

    // Storage preference
    const [storageMode, setStorageMode] = useState<"cloud" | "device">("cloud");

    // File upload state
    const [uploading, setUploading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [parsedResume, setParsedResume] = useState<ResumeData | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Trigger local AI pre-warm silently when modal opens
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        void initLocalAiLadder()
            .then(() => {
                if (!cancelled) setModelReady(true);
            })
            .catch(() => {
                // Non-fatal fallback
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const handleFileSelected = async (file: File) => {
        if (!file) return;

        setUploadedFile(file);
        setUploading(true);
        setUploadError(null);

        try {
            const outcome = await parseResumeFileForReview(file);
            if (!outcome.ok) {
                setUploadError(outcome.error);
                setParsedResume(null);
                return;
            }
            setParsedResume(outcome.parsed);
        } catch {
            setUploadError(PROFILE_REVIEW_UNREADABLE_ERROR);
            setParsedResume(null);
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
            void handleFileSelected(file);
        }
    };

    const handleFinish = () => {
        onComplete({
            resume: parsedResume,
            storageMode,
            accountCreated: false,
        });
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="max-w-xl p-0 rounded-panel border border-border bg-card"
                showCloseButton={false}
            >
                <div className="sr-only">
                    <DialogTitle>First-time Onboarding</DialogTitle>
                    <DialogDescription>
                        Orientation to the Velai job discovery platform, local AI privacy, and résumé onboarding.
                    </DialogDescription>
                </div>

                {/* Progress Header */}
                <div className="flex items-center justify-between border-b border-border bg-muted px-6 py-3.5">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-pill bg-brand animate-pulse" />
                        <span className="text-xs font-semibold text-muted-foreground">
                            Quick start
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <OnboardingStepLabel step={step} />
                        <span>·</span>
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                            Skip to search
                        </button>
                    </div>
                </div>

                <div className="h-1 w-full bg-muted">
                    <div
                        className="h-1 bg-brand transition-all duration-300 ease-out"
                        style={{ width: `${(step / 3) * 100}%` }}
                    />
                </div>

                <DialogBody>
                {/* Step 1: Tour & Value Proposition */}
                {step === 1 && (
                    <div className="p-6 sm:p-7 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-xl sm:text-2xl font-semibold text-foreground">
                                Job hunting without the noise
                            </h2>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Here is how Velai helps you find and apply to roles faster:
                            </p>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-start gap-3 rounded-ctl border border-border p-3.5 bg-card">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl bg-muted text-xs font-semibold text-brand">
                                    1
                                </div>
                                <div>
                                    <h3 className="text-xs font-semibold text-foreground">Real, active jobs only</h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                                        We check every listing to make sure the company is actively interviewing—so you never waste time on stale listings or expired posts.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 rounded-ctl border border-border p-3.5 bg-card">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl bg-muted text-xs font-semibold text-brand">
                                    2
                                </div>
                                <div>
                                    <h3 className="text-xs font-semibold text-foreground">Private parsing, server-side matching</h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                                        {ONBOARDING_MATCHING_PRIVACY}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 rounded-ctl border border-border p-3.5 bg-card">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl bg-muted text-xs font-semibold text-brand">
                                    3
                                </div>
                                <div>
                                    <h3 className="text-xs font-semibold text-foreground">Tailored applications in one click</h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                                        Download a custom résumé tailored specifically to the requirements of the job you want to apply for.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Background Pre-warm Card */}
                        <div className="flex items-center justify-between rounded-ctl border border-border bg-card p-3 text-xs">
                            <div className="flex items-center gap-2.5">
                                <Cpu size={16} className={cn("text-brand", !modelReady && "animate-spin")} />
                                <span className="font-normal text-foreground">
                                    {modelReady ? "Private assistant ready" : "Preparing your private assistant…"}
                                </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {modelReady ? "Ready ✓" : "Takes a few seconds"}
                            </span>
                        </div>

                        <div className="flex justify-end pt-1">
                            <Button onClick={() => setStep(2)} className="gap-2 text-xs font-semibold">
                                Next: Create your account <ArrowRight size={16} />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 2: Create Account First */}
                {step === 2 && (
                    <div className="p-6 sm:p-7 space-y-5">
                        <div className="space-y-1">
                            <h2 className="text-lg sm:text-xl font-semibold text-foreground">
                                Create your free account
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                Save your matched roles, track applications, and get email alerts when new verified jobs open up.
                            </p>
                        </div>

                        <div className="space-y-3 pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    onOpenAuth?.();
                                    setStep(3);
                                }}
                                className="w-full h-11 rounded-ctl border border-border bg-card hover:bg-muted text-xs font-semibold flex items-center justify-center gap-2.5 transition-colors"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                                </svg>
                                Continue with Google
                            </button>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <div className="h-px bg-border flex-1" />
                                <span>or email</span>
                                <div className="h-px bg-border flex-1" />
                            </div>

                            <div className="space-y-2">
                                <input
                                    type="email"
                                    placeholder="you@work.com"
                                    className="w-full h-11 px-3 rounded-ctl border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground"
                                />
                                <Button
                                    type="button"
                                    onClick={() => {
                                        onOpenAuth?.();
                                        setStep(3);
                                    }}
                                    className="w-full h-11 text-xs font-semibold"
                                >
                                    Continue with email
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-ctl border border-border bg-card p-3 flex items-center justify-between text-xs text-muted-foreground">
                            <span>No spam, ever. We never share your email with recruiters.</span>
                            <button
                                type="button"
                                onClick={() => setStep(3)}
                                className="text-foreground underline underline-offset-2 font-normal shrink-0 ml-2"
                            >
                                Continue as guest →
                            </button>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="gap-1.5 text-xs font-normal">
                                <ArrowLeft size={16} /> Back
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Add Résumé & Privacy/Storage Choice */}
                {step === 3 && (
                    <div className="p-6 sm:p-7 space-y-5">
                        <div className="space-y-1">
                            <h2 className="text-lg sm:text-xl font-semibold text-foreground">
                                Add your résumé
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                We use your experience to find matching roles and customize your applications.
                            </p>
                        </div>

                        {/* Privacy Banner */}
                        <div className="rounded-ctl border border-border bg-card p-3 flex items-start gap-2.5">
                            <ShieldCheck size={16} className="text-live shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                <strong className="text-foreground font-semibold">{ONBOARDING_UPLOAD_PRIVACY_LABEL}</strong>{" "}
                                {ONBOARDING_UPLOAD_PRIVACY_BODY}
                            </p>
                        </div>

                        {/* Upload Zone */}
                        <div
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                "group cursor-pointer rounded-ctl border border-dashed border-border p-5 text-center transition-colors hover:border-foreground bg-card",
                                uploadedFile && "border-live",
                            )}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.docx,.txt"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleFileSelected(file);
                                }}
                            />
                            {uploading ? (
                                <div className="space-y-2 py-2">
                                    <Cpu size={24} className="mx-auto animate-spin text-brand" />
                                    <p className="text-xs font-semibold text-foreground">Reading résumé privately on your computer…</p>
                                </div>
                            ) : uploadedFile ? (
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-2 text-left">
                                        <FilePdf size={24} className="text-brand shrink-0" />
                                        <div>
                                            <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">{uploadedFile.name}</p>
                                            <p className="text-xs text-live">
                                                Résumé ready ✓
                                            </p>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground font-normal">Replace</Button>
                                </div>
                            ) : (
                                <div className="space-y-1 py-2">
                                    <UploadSimple size={24} className="mx-auto text-muted-foreground group-hover:text-brand transition-colors" />
                                    <p className="text-xs font-semibold text-foreground">
                                        Drop your résumé here, or <span className="text-brand underline underline-offset-2">browse files</span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">PDF or Word document (.docx)</p>
                                </div>
                            )}
                            {uploadError && (
                                <p className="mt-2 text-xs text-danger-text">{uploadError}</p>
                            )}
                        </div>

                        {/* Storage Choice */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-muted-foreground">
                                Where should we save your résumé?
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div
                                    onClick={() => setStorageMode("cloud")}
                                    className={cn(
                                        "cursor-pointer rounded-ctl border p-3 transition-colors",
                                        storageMode === "cloud"
                                            ? "border-brand bg-card ring-1 ring-brand"
                                            : "border-border hover:border-foreground bg-card",
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <CloudCheck size={16} className="text-brand" />
                                            Save to my account
                                        </div>
                                        {storageMode === "cloud" && <span className="h-1.5 w-1.5 rounded-pill bg-brand" />}
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground leading-snug">
                                        Recommended. Access your matched roles across your phone and laptop, and get alerts.
                                    </p>
                                </div>

                                <div
                                    onClick={() => setStorageMode("device")}
                                    className={cn(
                                        "cursor-pointer rounded-ctl border p-3 transition-colors",
                                        storageMode === "device"
                                            ? "border-brand bg-card ring-1 ring-brand"
                                            : "border-border hover:border-foreground bg-card",
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <HardDrive size={16} className="text-muted-foreground" />
                                            Keep only on this computer
                                        </div>
                                        {storageMode === "device" && <span className="h-1.5 w-1.5 rounded-pill bg-brand" />}
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground leading-snug">
                                        Maximum privacy. Stored only in this web browser. Nothing is ever sent to our servers.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="gap-1.5 text-xs font-normal">
                                <ArrowLeft size={16} /> Back
                            </Button>
                            <Button onClick={handleFinish} className="gap-2 text-xs font-semibold">
                                <Sparkle size={16} />
                                See your matching jobs →
                            </Button>
                        </div>
                    </div>
                )}
                </DialogBody>
            </DialogContent>
        </Dialog>
    );
}
