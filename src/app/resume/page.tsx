"use client";

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { FileText } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const RESUME_SUBCOPY = "Your one base resume. Connect your AI to tailor a version for each role.";

function ResumeHeader() {
    return <PageHeader size="display" fullWidth sticky={false} title="Resume" description={RESUME_SUBCOPY} />;
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

function SignedOutState({ onLoginClick }: { onLoginClick: () => void }) {
    return (
        <div className="space-y-4 rounded-none border border-dashed border-border bg-card p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-border bg-muted/40 text-foreground">
                <FileText size={24} />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-semibold text-foreground">Sign in to see your resume</h3>
                <p className="text-xs text-muted-foreground">
                    Your resume and any versions you tailor for a role live on your account.
                </p>
            </div>
            <Button size="sm" onClick={onLoginClick} className="rounded-none">
                Sign in
            </Button>
        </div>
    );
}

function ResumeContent() {
    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    // Already resolved if a session was cached at mount; otherwise flips true
    // the moment onAuthChange's first callback fires (may still land on
    // `null` for a genuinely signed-out visitor).
    const [authReady, setAuthReady] = useState(() => getCurrentUser() !== null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);

    useEffect(() => {
        const unsub = onAuthChange((u) => {
            setUser(u);
            setAuthReady(true);
        });
        return () => unsub();
    }, []);

    return (
        <PageLayout fullWidth header={!editorOpen ? <ResumeHeader /> : undefined}>
            <div
                className={cn(
                    "mx-auto transition-all",
                    editorOpen
                        ? "max-w-6xl px-0 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-6 xl:max-w-7xl xl:px-10"
                        : "max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10",
                )}
            >
                {!authReady ? (
                    <ResumeAuthSkeleton />
                ) : !user ? (
                    <SignedOutState onLoginClick={() => setAuthPopoverOpen(true)} />
                ) : (
                    <YourResumeSection
                        user={user}
                        onLoginClick={() => setAuthPopoverOpen(true)}
                        embedded
                        onEditorActiveChange={setEditorOpen}
                    />
                )}

                <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
            </div>
        </PageLayout>
    );
}

export default function ResumePage() {
    return <ResumeContent />;
}
