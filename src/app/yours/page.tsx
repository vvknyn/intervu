"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import {
    boardColumn,
    boardTimestampLabel,
    boardTruthLine,
    isEnded,
    nextAction,
    stageLabel,
    type BoardColumn,
    type Pursuit,
} from "@/lib/pursuits/types";

/** The page's one display moment, rendered identically for every page state
 *  (loading / guest gate / populated board) via the shared `PageHeader` in
 *  its "display" size — so "Tracker" never competes with a second heading
 *  below it, and the masthead matches Stories/Prep/Resume's rhythm exactly. */
function TrackerHeader({ subtitle, actions }: { subtitle: React.ReactNode; actions?: React.ReactNode }) {
    return <PageHeader size="display" fullWidth sticky={false} title="Tracker" description={subtitle} actions={actions} />;
}

const SUMMARY_COLUMNS: { key: Exclude<BoardColumn, "closed">; label: string }[] = [
    { key: "saved", label: "saved" },
    { key: "applied", label: "applied" },
    { key: "interviewing", label: "interviewing" },
    { key: "offer", label: "offers" },
];

/** Header subtitle: "0 saved · 0 applied · 0 interviewing · 0 offers" with
 *  each count linked down to its board column (spec: "mono summary sentence
 *  with linked counts"). Reads the same `groups` the board renders from, so
 *  the two can never disagree. */
function TrackerSummary({ groups }: { groups: Record<BoardColumn, Pursuit[]> }) {
    return (
        <>
            {SUMMARY_COLUMNS.map((col, i) => (
                <span key={col.key}>
                    {i > 0 && " · "}
                    <a href={`#col-${col.key}`} className="text-foreground underline-offset-2 hover:underline">
                        <span className="tabular-nums">{groups[col.key].length}</span> {col.label}
                    </a>
                </span>
            ))}
        </>
    );
}

function YoursLoading() {
    return (
        <PageLayout fullWidth header={<TrackerHeader subtitle="Loading…" />}>
            <div className="mx-auto w-full max-w-[1440px] px-6 py-8 sm:px-10 lg:px-14">
                <p className="font-mono text-[13px] text-muted-foreground">Loading your tracker…</p>
            </div>
        </PageLayout>
    );
}

/** Column head (docs-mockup.html Comp C): mono uppercase label, 2px ink
 *  underline, count right-aligned in ink. `id` is the summary sentence's
 *  jump target. */
function ColumnHead({ id, label, count }: { id: string; label: string; count: number }) {
    return (
        <div
            id={id}
            className="scroll-mt-4 flex items-center justify-between border-b-2 border-foreground px-3 pb-2 pt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground"
        >
            <span>{label}</span>
            <span className="tabular-nums text-foreground">{count}</span>
        </div>
    );
}

/** Empty column = dashed empty block (docs-mockup.html Comp C), not a bare
 *  sentence — the squared system's one "nothing here" shape, shared with the
 *  Resume/Prep dashed empties. */
function EmptyColumn({ text, link }: { text: string; link?: { href: string; label: string } }) {
    return (
        <div className="m-3 border border-dashed border-border bg-card px-4 py-6 text-center">
            <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">
                {text}
                {link && (
                    <>
                        {" "}
                        <Link href={link.href} className="text-foreground underline underline-offset-2 hover:opacity-70">
                            {link.label}
                        </Link>
                    </>
                )}
            </p>
        </div>
    );
}

/** One board card (docs-mockup.html Comp C `.tcard`): squared border, title +
 *  company, then a mono truth-line built ONLY from real per-row data
 *  (`boardTruthLine` — linked resume version / prep recency, degrading by
 *  omission), then the existing timestamp + next-action line unchanged. The
 *  action's own `kind` (not the raw stage name) decides whether it reads as
 *  outstanding (ink, underlined) or resting (closed). Ended pursuits dim. */
function BoardRow({ pursuit, onClick }: { pursuit: Pursuit; onClick: () => void }) {
    const action = nextAction(pursuit);
    const actionable = action.kind !== "closed";
    const truthLine = boardTruthLine(pursuit);
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
                "mt-3 cursor-pointer border border-border bg-card px-3.5 py-3 text-left transition-colors duration-100 hover:bg-muted/40",
                isEnded(pursuit) && "opacity-60",
            )}
        >
            <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="truncate text-[13.5px] font-semibold leading-snug">{pursuit.position}</span>
                <span className="truncate text-[12px] text-text-2">{pursuit.company_name}</span>
            </div>
            {truthLine && <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{truthLine}</div>}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
                <span className="text-muted-foreground">{boardTimestampLabel(pursuit)}</span>
                <span className={actionable ? "text-foreground underline underline-offset-2" : "text-muted-foreground"}>
                    {action.label}
                </span>
            </div>
        </div>
    );
}

/** Groups + sorts (most-recently-updated first within each column) in one
 *  pass — the single source both the summary sentence and the board read, so
 *  their counts can never drift apart. */
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
        empty: { text: "Nothing saved.", link: { href: "/", label: "Save a role from the ledger →" } },
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
    const guestSyncInFlightRef = useRef(false);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    // Merge-at-sign-in (pursuits + follows) — at most once per load; only mark
    // done after both merges succeed so a failed sign-in sync retries.
    useEffect(() => {
        if (user && !guestSyncRef.current && !guestSyncInFlightRef.current) {
            guestSyncInFlightRef.current = true;
            void (async () => {
                try {
                    const [pursuitsOk, followsOk] = await Promise.all([
                        syncGuestPursuitsToServer(),
                        syncGuestFollowsToServer(),
                    ]);
                    if (pursuitsOk && followsOk) {
                        guestSyncRef.current = true;
                    }
                } finally {
                    guestSyncInFlightRef.current = false;
                }
            })();
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
            <PageLayout
                fullWidth
                header={<TrackerHeader subtitle="0 saved · 0 applied · 0 interviewing · 0 offers" />}
            >
                <div
                    data-testid="yours-guest-empty"
                    className="mx-auto w-full max-w-[1440px] px-6 py-10 text-left sm:px-10 lg:px-14"
                >
                    <p className="text-[14px] text-foreground">{pickRandom(LOGIN_REQUIRED.applications.headings)}</p>
                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
                        {pickRandom(LOGIN_REQUIRED.applications.subtexts)}
                    </p>
                    <div className="mt-4">
                        <Button size="sm" onClick={() => setAuthPopoverOpen(true)}>Log in</Button>
                    </div>
                    <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                </div>
            </PageLayout>
        );
    }

    if (loading) return <YoursLoading />;

    const groups = groupByColumn(pursuits);
    const total = pursuits.length;

    return (
        <PageLayout
            fullWidth
            header={
                <TrackerHeader
                    subtitle={<TrackerSummary groups={groups} />}
                    actions={<Button size="sm" onClick={openWizard}>Add manually</Button>}
                />
            }
        >
            <div className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-6 sm:px-10 lg:px-14">
                <div
                    data-testid={total === 0 ? "yours-empty" : undefined}
                    className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
                >
                    {COLUMNS.map((col) => {
                        const cards = groups[col.key];
                        return (
                            <div key={col.key} className="min-w-0">
                                <ColumnHead id={`col-${col.key}`} label={col.label} count={cards.length} />
                                {cards.length === 0 ? (
                                    <EmptyColumn text={col.empty.text} link={col.empty.link} />
                                ) : (
                                    cards.map((p) => (
                                        <BoardRow key={p.id} pursuit={p} onClick={() => router.push(`/yours/${p.id}`)} />
                                    ))
                                )}
                            </div>
                        );
                    })}
                </div>

                {groups.closed.length > 0 && (
                    <details className="group mt-8 border-t border-border pt-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[13px] font-medium text-foreground">
                            <span>Closed (<span className="tabular-nums">{groups.closed.length}</span>)</span>
                            <span className="text-muted-foreground transition-transform duration-100 group-open:rotate-180">▾</span>
                        </summary>
                        <div className="mt-2 divide-y divide-border border-t border-border">
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
                                    className="cursor-pointer px-1 py-3 text-left opacity-60 transition-colors duration-100 hover:bg-muted/40"
                                >
                                    <div className="truncate text-[13.5px] font-medium">
                                        {p.position}
                                        <span className="font-normal text-text-2"> — {p.company_name}</span>
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                        {stageLabel(p)} · {boardTimestampLabel(p)}
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
