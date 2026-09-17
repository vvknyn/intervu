"use client";

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { LiveResumePreview } from "@/components/resume-builder/LiveResumePreview";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { readLocalAiResume, writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { AUTH_CTA_LABEL, formatAuthGateValueLine, type AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import type { ResumeData } from "@/types/resume";
import { FileText, UploadSimple, ShieldCheck, PencilSimple, DownloadSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const RESUME_SUBCOPY = "Your one base resume. Connect your AI to tailor a version for each role.";

function ResumeHeader() {
    return <PageHeader fullWidth sticky={false} title="Resume" description={RESUME_SUBCOPY} />;
}

function ResumeAuthSkeleton() {
    return (
        <div className="space-y-4 rounded-none border border-border bg-card p-8" role="status" aria-busy="true">
            <span className="sr-only">Loading resume</span>
            <div aria-hidden className="mx-auto max-w-sm space-y-3">
                <div className="skeleton-bar mx-auto h-12 w-12" />
                <div className="skeleton-bar mx-auto h-4 w-48" />
                <div className="skeleton-bar mx-auto h-3 w-full" />
            </div>
        </div>
    );
}

function SignedOutEmptyState({
    onLoginClick,
    onUploadClick,
}: {
    onLoginClick: () => void;
    onUploadClick: () => void;
}) {
    return (
        <div className="mx-auto max-w-[480px] space-y-4 rounded-none border border-border bg-card p-8 text-center">
            <div className="inline-flex items-center gap-1.5 border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-brand">
                <ShieldCheck size={16} />
                <span>100% On-Device AI</span>
            </div>
            <FileText size={24} className="mx-auto text-muted-foreground" />
            <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Add your base resume</h2>
                <p className="text-sm text-muted-foreground">
                    Upload a PDF or Word document. We parse it locally in your browser so your data never touches cloud servers.
                </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                <Button size="sm" onClick={onUploadClick} className="w-full sm:w-auto rounded-none font-semibold">
                    <UploadSimple size={16} className="mr-1.5" aria-hidden />
                    Upload resume
                </Button>
                <Button variant="outline" size="sm" onClick={onLoginClick} className="w-full sm:w-auto rounded-none font-semibold">
                    {AUTH_CTA_LABEL}
                </Button>
            </div>
        </div>
    );
}

function ResumeContent() {
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const [authReady, setAuthReady] = useState(() => getCurrentUser() !== null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [authTrigger, setAuthTrigger] = useState<AuthGateTrigger>("user");
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [localResume, setLocalResume] = useState<ResumeData | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthChange((nextUser) => {
            setUser(nextUser);
            setAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user && authReady) {
            const stored = readLocalAiResume();
            setLocalResume(stored?.data ?? null);
        }
    }, [user, authReady]);

    // Edit/PDF gate an action whose label is NOT "sign in" (the click's
    // intent is to edit/export, not to authenticate) — auto, same as the
    // apply/save gates elsewhere. "Sign up to sync" and every `onLoginClick`
    // below render nothing but a sign-in affordance — user.
    const openAuth = (trigger: AuthGateTrigger) => {
        setAuthTrigger(trigger);
        setAuthPopoverOpen(true);
    };

    const handleImportResume = (data: ResumeData) => {
        writeLocalAiResume(data);
        setLocalResume(data);
        setImportModalOpen(false);
    };

    return (
        <PageLayout fullWidth header={!editorOpen ? <ResumeHeader /> : undefined}>
            <div
                className={cn(
                    "mx-auto transition-all",
                    editorOpen
                        ? "max-w-6xl px-0 pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-6 xl:max-w-7xl xl:px-10"
                        : "max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10",
                )}
            >
                {!authReady ? (
                    <ResumeAuthSkeleton />
                ) : !user ? (
                    localResume ? (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 border border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
                                <ShieldCheck size={16} className="text-brand shrink-0" />
                                <span className="font-semibold text-foreground">100% On-Device AI</span>
                                <span>— Parsed privately in your browser. Never stored in the cloud without an account.</span>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-none border border-border bg-card p-4">
                                <div className="flex items-center gap-2.5">
                                    <FileText size={20} className="text-brand shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">Local resume on this device</p>
                                        <p className="text-xs text-muted-foreground">Create a free account to edit in the full builder, export formatted PDFs, and sync across devices.</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setImportModalOpen(true)}
                                        className="rounded-none text-xs font-semibold"
                                    >
                                        Replace
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openAuth("auto")}
                                        className="rounded-none text-xs font-semibold"
                                    >
                                        <PencilSimple size={16} className="mr-1" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openAuth("auto")}
                                        className="rounded-none text-xs font-semibold"
                                    >
                                        <DownloadSimple size={16} className="mr-1" />
                                        PDF
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={() => openAuth("user")}
                                        className="rounded-none text-xs font-semibold"
                                    >
                                        Sign up to sync
                                    </Button>
                                </div>
                            </div>
                            <LiveResumePreview data={localResume} />
                        </div>
                    ) : (
                        <SignedOutEmptyState
                            onLoginClick={() => openAuth("user")}
                            onUploadClick={() => setImportModalOpen(true)}
                        />
                    )
                ) : (
                    <YourResumeSection
                        user={user}
                        onLoginClick={() => openAuth("user")}
                        embedded
                        onEditorActiveChange={setEditorOpen}
                    />
                )}

                <ResumeImportModal
                    isOpen={importModalOpen}
                    onClose={() => setImportModalOpen(false)}
                    onImport={handleImportResume}
                    title="Upload your base resume"
                    description="Drop your existing resume to parse into your base profile."
                />

                <AuthPopover
                    open={authPopoverOpen}
                    onOpenChange={setAuthPopoverOpen}
                    showTrigger={false}
                    trigger={authTrigger}
                    defaultTab="signup"
                    reason="resume"
                    valueLine={formatAuthGateValueLine("resume")}
                />
            </div>
        </PageLayout>
    );
}

export default function ResumePage() {
    return <ResumeContent />;
}
