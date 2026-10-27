"use client";

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { GuestResumeReadout } from "@/components/resume-builder/GuestResumeReadout";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { clearLocalAiResume, readLocalAiResume, writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { removeGuestAppliedResumes } from "@/lib/pursuits/guest-store";
import { useAdoptGuestResume } from "@/hooks/use-adopt-guest-resume";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import Link from "next/link";
import { formatAuthGateValueLine, type AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import { recordAuthGateOpen } from "@/lib/auth/open-auth-gate";
import {
    RESUME_IMPORT_STORAGE_NOTE,
    RESUME_LOCAL_DEVICE_BANNER_BODY,
    RESUME_LOCAL_DEVICE_BANNER_LABEL,
    RESUME_PAGE_HEADLINE,
    RESUME_PAGE_SUBCOPY,
    RESUME_PAGE_SUBCOPY_SIGNED_IN,
    RESUME_SIGNED_OUT_EMPTY_TITLE,
    RESUME_UPLOAD_PROMISE,
} from "@/lib/jobs/resume-privacy-copy";
import type { ResumeIntent } from "@/lib/jobs/pending-actions";
import type { ResumeData } from "@/types/resume";
import { FileText, UploadSimple, ShieldCheck, PencilSimple, DownloadSimple } from "@phosphor-icons/react";
import { posterInlinePanelClassName } from "@/components/layout/route-loading";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { useAgentPreferences } from "@/hooks/use-agent-preferences";
import { scoringPreferences } from "@/lib/agent-preferences-read";

function ResumeHeader({ signedIn }: { signedIn: boolean }) {
    return (
        <PageHeader
            fullWidth
            sticky={false}
            size="display"
            title={RESUME_PAGE_HEADLINE}
            // The signed-out line ends "…once you sign in", which read oddly
            // to someone already signed in.
            description={signedIn ? RESUME_PAGE_SUBCOPY_SIGNED_IN : RESUME_PAGE_SUBCOPY}
        />
    );
}

function ResumeAuthSkeleton() {
    return (
        <WaitState
            label="Loading resume"
            className={cn(posterInlinePanelClassName, "p-8")}
            skeleton={
                <div className="mx-auto max-w-sm space-y-3">
                    <WaitBar className="mx-auto h-12 w-12" />
                    <WaitBar className="mx-auto h-4 w-48" />
                    <WaitBar className="mx-auto h-3 w-full" />
                </div>
            }
        />
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
                    onClick={onUploadClick}
                    data-testid="resume-signed-out-upload"
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
    // Settings' Experience level, so the import review shows the level ranking reads.
    const agentPrefs = scoringPreferences(useAgentPreferences(user?.uid ?? null));
    const [localResume, setLocalResume] = useState<ResumeData | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [resumeIntent, setResumeIntent] = useState<ResumeIntent | null>(null);
    // Bumped when a guest résumé lands in the account, so the account view
    // mounts again and reads it.
    const [adoptedToken, setAdoptedToken] = useState(0);

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
    // open the popover. `apply` is never queued from this page —
    // `PendingAction`'s kinds are shared with /jobs, and
    // `takePersistedPendingAction` is path-scoped (pending-actions.ts), so a
    // /jobs-queued action can never replay here — but the hook's handler map
    // is total over every kind, so it's still a typed, inert no-op.
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<never>({
        handlers: {
            apply: () => {},
            upload: () => {
                setImportModalOpen(true);
            },
            // Edit or PDF clicked on a device résumé before signing up: the signed-in view carries it out (`YourResumeSection`'s `intent`).
            resume: (action) => setResumeIntent(action.payload),
        },
        user,
    });

    useEffect(() => {
        if (!user && authReady) {
            const stored = readLocalAiResume();
            setLocalResume(stored?.data ?? null);
        }
    }, [user, authReady]);

    // A guest who uploads here and then creates an account (Edit, PDF and
    // Sign up to sync all open sign-up) used to land on "No resume on file":
    // only /jobs moved the browser copy into the account.
    const adoptionSettled = useAdoptGuestResume(user?.uid ?? null, "resume_page", () => setAdoptedToken((t) => t + 1));

    const removeLocalResume = () => {
        clearLocalAiResume();
        removeGuestAppliedResumes();
        setLocalResume(null);
        setConfirmingRemove(false);
    };

    // Edit and PDF queue what was clicked and finish it after sign-up; Sign up queues nothing.
    const openResumeAuth = (intent?: ResumeIntent) => {
        setAuthTrigger("user");
        recordAuthGateOpen({
            storage: window.sessionStorage,
            reason: "resume",
            trigger: "user",
            originSurface: "resume_page",
        });
        if (!localResume) {
            gate({ kind: "upload", payload: true }, { originSurface: "resume_page", gateReason: "resume" });
        } else if (intent) {
            gate({ kind: "resume", payload: intent }, { originSurface: "resume_page", gateReason: "resume" });
        } else {
            setAuthOpen(true);
        }
    };

    const handleImportResume = (data: ResumeData, _source: string, _confidence: number, sourceLabel: string) => {
        // Pass the new file's name, or /jobs keeps "Scoring with" the old one.
        writeLocalAiResume(data, undefined, sourceLabel);
        setLocalResume(data);
        setImportModalOpen(false);
    };

    // Opens the importer for guests and signed-in users. Cloud sync (Edit,
    // PDF, Sign up to sync) is the auth path — see `openResumeAuth`.
    const beginResumeUpload = () => {
        setImportModalOpen(true);
    };

    return (
        <PageLayout fullWidth header={!editorOpen ? <ResumeHeader signedIn={!!user} /> : undefined}>
            <div
                className={cn(
                    "transition-all",
                    editorOpen
                        // page-scale-allow: the open editor's canvas runs edge to edge below lg
                        ? "mx-auto max-w-6xl px-0 pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-6 xl:max-w-7xl xl:px-10"
                        : "shell-row pb-16 pt-6",
                )}
            >
                {!authReady ? (
                    <ResumeAuthSkeleton />
                ) : !user ? (
                    localResume ? (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 rounded-panel border border-border bg-surface-2 px-4 py-2.5 text-xs text-muted-foreground shadow-[var(--shadow-bevel-inset)]">
                                <ShieldCheck size={16} className="text-live shrink-0" />
                                {/* One run of text, so the label doesn't squeeze into a narrow column beside the body on a phone. */}
                                <p>
                                    <span className="font-semibold text-foreground">{RESUME_LOCAL_DEVICE_BANNER_LABEL}</span>{" "}
                                    — {RESUME_LOCAL_DEVICE_BANNER_BODY}
                                </p>
                            </div>
                            <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow-bevel-highlight)] sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-start gap-2.5 min-w-0">
                                    <FileText size={20} className="text-live shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-foreground">Local résumé on this device</p>
                                        {/* signup-gate-exempt: state description beside buttons that open the auth dialog on an explicit click */}
                                        <p
                                            data-testid="resume-local-account-pitch"
                                            className="text-xs text-muted-foreground mt-0.5"
                                        >
                                            Saved in this browser · Sign up for saved jobs, alerts, and cloud sync
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <Button asChild size="sm">
                                        <Link href="/jobs" data-testid="resume-see-matches">
                                            See jobs ranked for this résumé
                                        </Link>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => beginResumeUpload()}
                                    >
                                        Replace
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openResumeAuth("edit")}
                                    >
                                        <PencilSimple size={16} className="mr-1" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openResumeAuth("pdf")}
                                    >
                                        <DownloadSimple size={16} className="mr-1" />
                                        PDF
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => openResumeAuth()}
                                    >
                                        {/* signup-gate-exempt: state description beside buttons that open the auth dialog on an explicit click */}Sign up
                                    </Button>
                                </div>
                            </div>
                            <GuestResumeReadout data={localResume} />
                            <div className="flex items-center justify-end text-xs">
                                {confirmingRemove ? (
                                    <InlineConfirm
                                        prompt="Remove this résumé from this device?"
                                        confirmLabel="Remove"
                                        onConfirm={removeLocalResume}
                                        onCancel={() => setConfirmingRemove(false)}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        data-testid="resume-remove-local"
                                        onClick={() => setConfirmingRemove(true)}
                                        className="text-muted-foreground underline underline-offset-2 hover:text-danger-text"
                                    >
                                        Remove from this device
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <SignedOutEmptyState onUploadClick={() => beginResumeUpload()} />
                    )
                ) : (
                    <YourResumeSection
                        key={adoptedToken}
                        user={user}
                        onLoginClick={() => openResumeAuth()}
                        embedded
                        onEditorActiveChange={setEditorOpen}
                        intent={adoptionSettled ? resumeIntent : null}
                        onIntentDone={() => setResumeIntent(null)}
                    />
                )}

                <ResumeImportModal
                    isOpen={importModalOpen}
                    onClose={() => setImportModalOpen(false)}
                    onImport={handleImportResume}
                    title="Upload your base résumé"
                    description={RESUME_UPLOAD_PROMISE}
                    storageNote={RESUME_IMPORT_STORAGE_NOTE}
                    agentPreferences={agentPrefs}
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
