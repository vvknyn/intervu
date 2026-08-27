"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { TailoredVersionsList } from "@/components/resume/TailoredVersionsList";
import { LiveResumePreview } from "@/components/resume-builder/LiveResumePreview";
import { tailoredVersionToResumeData } from "@/lib/resume/tailored-version";
import { fetchTailoredVersionAction, type TailoredVersionDetail } from "@/actions/tailor-resume";
import { FileText, ArrowLeft } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const RESUME_SUBCOPY = "One base resume. Tailor it per role from the apply dialog, then find it here.";

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

function ResumeLoading() {
    return (
        <PageLayout fullWidth header={<ResumeHeader />}>
            <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10">
                <ResumeAuthSkeleton />
            </div>
        </PageLayout>
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

/**
 * Renders one saved tailored version as a document — the destination for
 * the "Open" link on `/resume`'s tailored-versions list (`?v=<id>`,
 * previously wired to a route that never read the param). Ownership is
 * enforced server-side by `fetchTailoredVersionAction`; a version that
 * doesn't exist or isn't this user's returns the same generic error either
 * way, so this never leaks which case it was.
 */
function TailoredVersionView({ id }: { id: string }) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [detail, setDetail] = useState<TailoredVersionDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setStatus("loading");
        (async () => {
            const res = await fetchTailoredVersionAction(id);
            if (cancelled) return;
            if (res.error || !res.data) {
                setError(res.error || "Couldn't load this version");
                setStatus("error");
                return;
            }
            setDetail(res.data);
            setStatus("ready");
        })();
        return () => {
            cancelled = true;
        };
    }, [id]);

    const backLink = (
        <Link
            href="/resume"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
            <ArrowLeft size={14} /> Back to base resume
        </Link>
    );

    if (status === "loading") return <ResumeAuthSkeleton />;

    if (status === "error" || !detail) {
        return (
            <div className="space-y-4 rounded-none border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm text-muted-foreground">{error || "Couldn't load this version"}</p>
                {backLink}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                    Tailored for <span className="font-medium text-foreground">{detail.companyName}</span> ·{" "}
                    {detail.positionTitle}
                </p>
                {backLink}
            </div>
            <div className="bg-muted/30 p-4">
                <LiveResumePreview data={tailoredVersionToResumeData(detail)} />
            </div>
        </div>
    );
}

function ResumeContent() {
    const searchParams = useSearchParams();
    const versionId = searchParams.get("v");
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
                ) : versionId ? (
                    <TailoredVersionView id={versionId} />
                ) : (
                    <>
                        <YourResumeSection
                            user={user}
                            onLoginClick={() => setAuthPopoverOpen(true)}
                            embedded
                            onEditorActiveChange={setEditorOpen}
                        />
                        {!editorOpen && <TailoredVersionsList />}
                    </>
                )}

                <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
            </div>
        </PageLayout>
    );
}

export default function ResumePage() {
    return (
        <Suspense fallback={<ResumeLoading />}>
            <ResumeContent />
        </Suspense>
    );
}
