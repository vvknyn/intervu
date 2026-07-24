"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Buildings, CaretDown } from "@phosphor-icons/react";
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
import {
    boardColumn,
    boardTimestampLabel,
    isEnded,
    nextAction,
    stageLabel,
    type BoardColumn,
    type Pursuit,
} from "@/lib/pursuits/types";

function YoursLoading() {
    return (
        <PageLayout fullWidth>
            <div className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-8 sm:px-10 lg:px-14">
                <div className="mb-6 h-16 w-64 animate-pulse rounded-xl bg-card" />
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-40 animate-pulse rounded-xl bg-card" />
                    ))}
                </div>
            </div>
        </PageLayout>
    );
}

/** Column-header count chip: green tint once a column has anything in it,
 *  neutral chip while empty — mirrors the mock's Applied(9)-vs-rest
 *  treatment without inventing a separate "highlight" rule. */
function ColumnHeader({ label, count }: { label: string; count: number }) {
    return (
        <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">{label}</span>
            <span
                className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[11px]",
                    count > 0 ? "bg-green-tint-bg text-brand" : "bg-chip text-muted-foreground",
                )}
            >
                {count}
            </span>
        </div>
    );
}

function EmptyColumn({ text, link }: { text: string; link?: { href: string; label: string } }) {
    return (
        <div className="rounded-[10px] border-[1.5px] border-dashed border-border-strong px-4 py-6 text-center">
            <div className="text-[13px] leading-relaxed text-faint">{text}</div>
            {link && (
                <div className="mt-2.5">
                    <Link href={link.href} className="text-[12.5px] font-medium text-brand hover:underline">
                        {link.label}
                    </Link>
                </div>
            )}
        </div>
    );
}

/** One board card. Status line comes straight from `nextAction()` — the
 *  action's own `kind` (not the raw stage name) decides whether it reads as
 *  an outstanding step (live dot, brand text) or a resting state (offer,
 *  rejected, withdrawn all report kind "closed"). Ended pursuits also dim,
 *  same rule the old single-list page used. */
function BoardCard({ pursuit, onClick }: { pursuit: Pursuit; onClick: () => void }) {
    const action = nextAction(pursuit);
    const actionable = action.kind !== "closed";
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
                "cursor-pointer rounded-[10px] border border-border bg-card px-4 py-3.5 text-left transition-shadow hover:shadow-[var(--shadow-sm)]",
                isEnded(pursuit) && "opacity-60",
            )}
        >
            <div className="text-[14px] font-semibold leading-snug">{pursuit.position}</div>
            <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                {pursuit.company_name} · {boardTimestampLabel(pursuit)}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", actionable ? "bg-live" : "bg-faint")} />
                <span className={cn("font-mono text-[11px]", actionable ? "text-brand" : "text-muted-foreground")}>
                    {action.label}
                </span>
            </div>
        </div>
    );
}

function StatCard({ value, label }: { value: number; label: string }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="font-display text-[26px] font-bold leading-none tracking-tight">{value}</div>
            <div className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                {label}
            </div>
        </div>
    );
}

/** Groups + sorts (most-recently-updated first within each column) in one
 *  pass — the single source both the stat row and the board read, so their
 *  counts can never drift apart. */
function groupByColumn(pursuits: Pursuit[]): Record<BoardColumn, Pursuit[]> {
    const groups: Record<BoardColumn, Pursuit[]> = { saved: [], applied: [], interviewing: [], offer: [], closed: [] };
    for (const p of pursuits) groups[boardColumn(p)].push(p);
    for (const list of Object.values(groups)) {
        list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    }
    return groups;
}

const COLUMNS: { key: Exclude<BoardColumn, "closed">; label: string; empty: { text: string; link?: { href: string; label: string } } }[] = [
    {
        key: "saved",
        label: "Saved",
        empty: { text: "Nothing saved yet — tap ♡ on a match to park it here.", link: { href: "/", label: "Browse matches →" } },
    },
    { key: "applied", label: "Applied", empty: { text: "Nothing applied yet." } },
    {
        key: "interviewing",
        label: "Interviewing",
        empty: { text: "No interviews yet.", link: { href: "/prep", label: "Prep while you wait →" } },
    },
    { key: "offer", label: "Offer", empty: { text: "Offers will show up here." } },
];

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
            <PageLayout header={<PageHeader title="Tracker" />}>
                <div
                    data-testid="yours-guest-empty"
                    className="flex flex-col items-center justify-center px-4 py-32 text-center"
                >
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
                        <Buildings size={32} />
                    </div>
                    <h2 className="mb-2 font-display text-xl font-semibold tracking-tight">
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

    if (loading) return <YoursLoading />;

    const groups = groupByColumn(pursuits);
    const total = pursuits.length;

    return (
        <PageLayout fullWidth>
            <div className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-8 sm:px-10 lg:px-14">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="font-display text-[28px] font-semibold tracking-tight">Application tracker</h1>
                        <p className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">
                            {total} pursuit{total === 1 ? "" : "s"}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={openWizard} className="gap-1.5">
                        <Plus size={14} />
                        Add manually
                    </Button>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard value={groups.applied.length} label="Applied" />
                    <StatCard value={groups.interviewing.length} label="Interviewing" />
                    <StatCard value={groups.offer.length} label="Offers" />
                    <StatCard value={groups.closed.length} label="Closed" />
                </div>

                <div
                    data-testid={total === 0 ? "yours-empty" : undefined}
                    className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
                >
                    {COLUMNS.map((col) => {
                        const cards = groups[col.key];
                        return (
                            <div key={col.key}>
                                <ColumnHeader label={col.label} count={cards.length} />
                                {cards.length === 0 ? (
                                    <EmptyColumn text={col.empty.text} link={col.empty.link} />
                                ) : (
                                    <div className="flex flex-col gap-2.5">
                                        {cards.map((p) => (
                                            <BoardCard key={p.id} pursuit={p} onClick={() => router.push(`/yours/${p.id}`)} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {groups.closed.length > 0 && (
                    <details className="group mt-8 rounded-xl border border-border bg-card">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13.5px] font-semibold">
                            <span>Closed ({groups.closed.length})</span>
                            <CaretDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="divide-y divide-border border-t border-border">
                            {groups.closed.map((p) => (
                                <div
                                    key={p.id}
                                    role="button"
                                    tabIndex={0}
                                    data-testid="pursuit-row"
                                    onClick={() => router.push(`/yours/${p.id}`)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") router.push(`/yours/${p.id}`);
                                    }}
                                    className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 opacity-60 transition-colors hover:bg-muted/40"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate text-[13.5px] font-medium">
                                            {p.position}
                                            <span className="font-normal text-muted-foreground"> — {p.company_name}</span>
                                        </div>
                                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                            {stageLabel(p)} · {boardTimestampLabel(p)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>
                )}
            </div>
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
