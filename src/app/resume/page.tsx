"use client";

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { LiveResumePreview } from "@/components/resume-builder/LiveResumePreview";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { readLocalAiResume, writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { formatAuthGateValueLine, type AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import { recordAuthGateOpen } from "@/lib/auth/open-auth-gate";
import {
    RESUME_IMPORT_STORAGE_NOTE,
    RESUME_LOCAL_DEVICE_BANNER_BODY,
    RESUME_LOCAL_DEVICE_BANNER_LABEL,
    RESUME_PAGE_HEADLINE,
    RESUME_PAGE_SUBCOPY,
    RESUME_SIGNED_OUT_EMPTY_TITLE,
    RESUME_UPLOAD_PROMISE,
} from "@/lib/jobs/resume-privacy-copy";
import type { ResumeData } from "@/types/resume";
import { FileText, UploadSimple, ShieldCheck, PencilSimple, DownloadSimple } from "@phosphor-icons/react";
import { InlinePlaceholderPanel } from "@/components/layout/route-loading";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

function ResumeHeader() {
    return (
        <PageHeader
            fullWidth
            sticky={false}
            size="display"
            title={RESUME_PAGE_HEADLINE}
            description={RESUME_PAGE_SUBCOPY}
        />
    );
}

function ResumeAuthSkeleton() {
    return (
        <InlinePlaceholderPanel label="Loading resume" className="space-y-4">
            <div className="mx-auto max-w-sm space-y-3">
                <div className="skeleton-bar mx-auto h-12 w-12" />
                <div className="skeleton-bar mx-auto h-4 w-48" />
                <div className="skeleton-bar mx-auto h-3 w-full" />
            </div>
        </InlinePlaceholderPanel>
    );
}

// Empty state (§6): left-aligned, py-8, text-sm text-foreground, exactly ONE
// next action. "Sign in" is deliberately not a second action here —
// `beginResumeUpload` already gates the upload behind sign-in (see below),
// so the one button covers both intents; a separate login affordance would
// be a sideways tangent the conveyor rule forbids.
export function SignedOutEmptyState({ onUploadClick }: { onUploadClick: () => void }) {
    return (
        <EmptyState
            titled
            title={RESUME_SIGNED_OUT_EMPTY_TITLE}
            description={<span className="text-foreground">{RESUME_UPLOAD_PROMISE}</span>}
            actionsClassName="mt-4"
            actions={
                <Button
                    size="lg"
                    onClick={onUploadClick}
                    data-testid="resume-signed-out-upload"
                    className="rounded-ctl font-semibold"
                >
                    <UploadSimple size={16} className="mr-2" aria-hidden />
                    Upload résumé
                </Button>
            }
        />
    );
}

function ResumeContent() {
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    const [authReady, setAuthReady] = useState(() => getCurrentUser() !== null);
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

    // The one auth gate (`use-auth-gate.ts`), same mechanism /jobs uses: signed
    // in → run the handler now; signed out → persist the action (survives both
    // in-place login and a hard OAuth/passkey navigation away and back) and
    // open the popover. `apply`/`report` are never queued from this page —
    // `PendingAction`'s kinds are shared with /jobs, and
    // `takePersistedPendingAction` is path-scoped (pending-actions.ts), so a
    // /jobs-queued action can never replay here — but the hook's handler map
    // is total over every kind, so they're still typed, inert no-ops.
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<never, never>({
        handlers: {
            apply: () => {},
            upload: () => {
                setImportModalOpen(true);
            },
            report: () => {},
        },
        user,
    });

    useEffect(() => {
        if (!user && authReady) {
            const stored = readLocalAiResume();
            setLocalResume(stored?.data ?? null);
        }
    }, [user, authReady]);

    const openResumeAuth = () => {
        setAuthTrigger("user");
        recordAuthGateOpen({
            storage: window.sessionStorage,
            reason: "resume",
            trigger: "user",
            originSurface: "resume_page",
        });
        if (!localResume) {
            gate({ kind: "upload", payload: true }, { originSurface: "resume_page", gateReason: "resume" });
        } else {
            setAuthOpen(true);
        }
    };

    const handleImportResume = (data: ResumeData) => {
        writeLocalAiResume(data);
        setLocalResume(data);
        setImportModalOpen(false);
    };

    // Opens the importer for guests and signed-in users. Cloud sync (Edit,
    // PDF, Sign up to sync) is the auth path — see `openResumeAuth`.
    const beginResumeUpload = () => {
        setImportModalOpen(true);
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
                            <div className="flex items-center gap-2 rounded-panel border border-border bg-surface-2 px-4 py-3 text-xs text-muted-foreground shadow-[var(--shadow-bevel-inset)]">
                                <ShieldCheck size={16} className="text-live shrink-0" />
                                <span className="font-semibold text-foreground">{RESUME_LOCAL_DEVICE_BANNER_LABEL}</span>
                                <span>— {RESUME_LOCAL_DEVICE_BANNER_BODY}</span>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]">
                                <div className="flex items-center gap-2">
                                    <FileText size={20} className="text-live shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">Local résumé on this device</p>
                                        <p className="text-xs text-muted-foreground">Create a free account to edit in the full builder, export formatted PDFs, and sync across devices.</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => beginResumeUpload()}
                                        className="rounded-ctl text-xs font-semibold"
                                    >
                                        Replace
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openResumeAuth()}
                                        className="rounded-ctl text-xs font-semibold"
                                    >
                                        <PencilSimple size={16} className="mr-1" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openResumeAuth()}
                                        className="rounded-ctl text-xs font-semibold"
                                    >
                                        <DownloadSimple size={16} className="mr-1" />
                                        PDF
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={() => openResumeAuth()}
                                        className="rounded-ctl text-xs font-semibold"
                                    >
                                        Sign up to sync
                                    </Button>
                                </div>
                            </div>
                            <LiveResumePreview data={localResume} />
                        </div>
                    ) : (
                        <SignedOutEmptyState onUploadClick={() => beginResumeUpload()} />
                    )
                ) : (
                    <YourResumeSection
                        user={user}
                        onLoginClick={() => openResumeAuth()}
                        embedded
                        onEditorActiveChange={setEditorOpen}
                    />
                )}

                <ResumeImportModal
                    isOpen={importModalOpen}
                    onClose={() => setImportModalOpen(false)}
                    onImport={handleImportResume}
                    title="Upload your base résumé"
                    description={RESUME_UPLOAD_PROMISE}
                    storageNote={RESUME_IMPORT_STORAGE_NOTE}
                />

                <AuthPopover
                    open={authOpen}
                    onOpenChange={setAuthOpen}
                    onAuthed={onAuthed}
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
