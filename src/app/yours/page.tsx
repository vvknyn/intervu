"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Buildings } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { createApplication } from "@/actions/application";
import { saveTailoredVersion } from "@/actions/tailor-resume";
import { applyRecommendations } from "@/lib/resume/apply-recommendations";
import { ApplicationWizard, type ApplicationDraft } from "@/components/applications/ApplicationWizard";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { LOGIN_REQUIRED, pickRandom } from "@/lib/copy";
import { usePursuits, syncGuestPursuitsToServer, invalidatePursuitsCache } from "@/lib/pursuits/use-pursuits";
import { orderPursuits, nextAction, stageLabel, isEnded, type Pursuit } from "@/lib/pursuits/types";

function YoursLoading() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
                <p className="text-muted-foreground text-sm">Loading yours…</p>
            </div>
        </div>
    );
}

/** One next-action row (spec §5): company — role · stage in words · the one
 *  next action, in accent type. No status chip, no kanban — status is
 *  typography. Ended rows dim rather than turn red. */
function PursuitRow({ pursuit, onClick }: { pursuit: Pursuit; onClick: () => void }) {
    const ended = isEnded(pursuit);
    const action = nextAction(pursuit);
    return (
        <div
            role="button"
            tabIndex={0}
            data-testid="pursuit-row"
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onClick();
            }}
            className={cn(
                "flex w-full cursor-pointer items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/40",
                ended && "opacity-60",
            )}
        >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Buildings size={20} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                    {pursuit.company_name}
                    <span className="font-normal text-muted-foreground"> — {pursuit.position}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{stageLabel(pursuit)}</div>
            </div>
            {!ended && <div className="shrink-0 text-xs font-medium text-brand">{action.label}</div>}
        </div>
    );
}

function YoursContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [showWizard, setShowWizard] = useState(searchParams.get("view") === "new");
    const { pursuits, loading } = usePursuits();
    const guestSyncRef = useRef(false);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    // Merge-at-sign-in (spec §3/§7) — at most once per load.
    useEffect(() => {
        if (user && !guestSyncRef.current) {
            guestSyncRef.current = true;
            void syncGuestPursuitsToServer();
        }
    }, [user]);

    const openWizard = () => {
        setShowWizard(true);
        router.replace("/yours?view=new", { scroll: false });
    };
    const closeWizard = () => {
        setShowWizard(false);
        router.replace("/yours", { scroll: false });
    };

    const handleWizardComplete = async (draft: ApplicationDraft) => {
        try {
            let resumeVersionId: string | undefined;

            if (draft.selectedRecommendations && draft.selectedRecommendations.length > 0 && draft.baseResume) {
                const { tailoredSummary, tailoredExperience, tailoredCompetencies } = applyRecommendations(
                    draft.baseResume,
                    draft.selectedRecommendations,
                );
                const versionResult = await saveTailoredVersion({
                    versionName: draft.versionName || `${draft.jobAnalysis?.companyName} - ${draft.jobAnalysis?.positionTitle}`,
                    jobAnalysisId: draft.jobAnalysis?.id,
                    originalSummary: draft.baseResume.generatedSummary,
                    originalExperience: draft.baseResume.experience,
                    originalCompetencies: draft.baseResume.competencies,
                    originalProfile: draft.baseResume.profile,
                    originalEducation: draft.baseResume.education,
                    tailoredSummary,
                    tailoredExperience,
                    tailoredCompetencies,
                    recommendations: draft.selectedRecommendations,
                    companyName: draft.jobAnalysis?.companyName || "",
                    positionTitle: draft.jobAnalysis?.positionTitle || "",
                    appliedAt: draft.applicationDate,
                });
                if (versionResult.data?.id) resumeVersionId = versionResult.data.id;
            }

            const result = await createApplication({
                company_name: draft.jobAnalysis?.companyName || "Unknown Company",
                position: draft.jobAnalysis?.positionTitle || "Unknown Position",
                job_url: draft.jobUrl,
                applied_at: draft.applicationDate,
                status: draft.status || "applied",
                resume_version_id: resumeVersionId,
                cover_letter: draft.coverLetter,
            });
            if (result.error) throw new Error(result.error);

            invalidatePursuitsCache();
            closeWizard();
        } catch (e) {
            console.error("Failed to save application:", e);
            toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    if (showWizard) {
        return <ApplicationWizard onComplete={handleWizardComplete} onCancel={closeWizard} />;
    }

    // Guest, nothing local yet — quiet login state (no wall for go-after
    // itself, but there's nothing to show without an account or a guest
    // pursuit).
    if (!loading && !user && pursuits.length === 0) {
        return (
            <PageLayout header={<PageHeader title="Yours" />}>
                <div
                    data-testid="yours-guest-empty"
                    className="flex flex-col items-center justify-center px-4 py-32 text-center"
                >
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
                        <Buildings size={32} />
                    </div>
                    <h2 className="mb-2 text-xl font-semibold tracking-tight">
                        {pickRandom(LOGIN_REQUIRED.applications.headings)}
                    </h2>
                    <p className="mb-8 max-w-[400px] text-sm text-muted-foreground">
                        {pickRandom(LOGIN_REQUIRED.applications.subtexts)}
                    </p>
                    <Button onClick={() => setAuthPopoverOpen(true)} className="min-w-[120px]">
                        Log in
                    </Button>
                    <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                </div>
            </PageLayout>
        );
    }

    const ordered = orderPursuits(pursuits);
    const firstEndedIndex = ordered.findIndex(isEnded);

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Yours"
                    actions={
                        <Button variant="ghost" size="sm" onClick={openWizard} className="gap-1.5 text-muted-foreground">
                            <Plus size={14} />
                            Add manually
                        </Button>
                    }
                />
            }
        >
            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-[68px] animate-pulse rounded-xl bg-card" />
                    ))}
                </div>
            ) : ordered.length === 0 ? (
                <div data-testid="yours-empty" className="py-24 text-center text-sm text-muted-foreground">
                    Nothing here yet — go after a job to start.
                </div>
            ) : (
                <div className="space-y-2">
                    {ordered.map((p, i) => (
                        <div key={p.id}>
                            {i === firstEndedIndex && (
                                <div className="pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                    Ended
                                </div>
                            )}
                            <PursuitRow pursuit={p} onClick={() => router.push(`/yours/${p.id}`)} />
                        </div>
                    ))}
                </div>
            )}
        </PageLayout>
    );
}

export default function YoursPage() {
    return (
        <Suspense fallback={<YoursLoading />}>
            <YoursContent />
        </Suspense>
    );
}
