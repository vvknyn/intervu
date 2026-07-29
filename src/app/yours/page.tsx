"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageLayout } from "@/components/layout/PageLayout";
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
    isEnded,
    nextAction,
    stageLabel,
    type BoardColumn,
    type Pursuit,
} from "@/lib/pursuits/types";

/** Ink-rect affordance shared by every primary action on this page ("Add
 *  manually", "Log in") — same grammar as the jobs ledger's [SEARCH]
 *  button (src/app/page.tsx): solid ink bg, paper text, mono uppercase. */
function InkButton({
    onClick,
    children,
}: {
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="h-8 shrink-0 bg-foreground px-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-background transition-opacity duration-100 hover:opacity-85"
        >
            {children}
        </button>
    );
}

/** The page's one display moment (spec: "Archivo 800, the page's one
 *  heading") plus a mono subtitle line — rendered identically for every
 *  page state (loading / guest gate / populated board) via PageLayout's
 *  `header` slot, so "Tracker" never competes with a second heading below it. */
function TrackerHeader({ subtitle, actions }: { subtitle: React.ReactNode; actions?: React.ReactNode }) {
    return (
        <div className="border-b border-foreground bg-background">
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-end justify-between gap-3 px-6 pb-4 pt-8 sm:px-10 lg:px-14">
                <div>
                    <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em]">Tracker</h1>
                    <div className="mt-1.5 font-mono text-[12.5px] text-muted-foreground">{subtitle}</div>
                </div>
                {actions}
            </div>
        </div>
    );
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
                        {groups[col.key].length} {col.label}
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

/** Column head: mono micro-label + live count, ruled with the same ink
 *  underline the ledger's own column-head row uses. `id` is the summary
 *  sentence's jump target. */
function ColumnHead({ id, label, count }: { id: string; label: string; count: number }) {
    return (
        <div
            id={id}
            className="scroll-mt-4 border-b border-foreground px-3 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
        >
            {label} ({count})
        </div>
    );
}

/** One left-aligned mono sentence — no centered dashed box (anti-marker 5). */
function EmptyColumn({ text, link }: { text: string; link?: { href: string; label: string } }) {
    return (
        <p className="px-3 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
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
    );
}

/** One board entry: dense two-line text row (title+company / mono timestamp
 *  + next-action, action underlined) — no card, no dot jewelry. The
 *  action's own `kind` (not the raw stage name) decides whether it reads as
 *  outstanding (ink, underlined) or resting (offer/rejected/withdrawn all
 *  report kind "closed"). Ended pursuits also dim, same rule the old
 *  single-list page used. */
function BoardRow({ pursuit, onClick }: { pursuit: Pursuit; onClick: () => void }) {
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
                "cursor-pointer px-3 py-3 text-left transition-colors duration-100 hover:bg-muted/40",
                isEnded(pursuit) && "opacity-60",
            )}
        >
            <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="truncate text-[13.5px] font-semibold leading-snug">{pursuit.position}</span>
                <span className="truncate text-[12px] text-text-2">{pursuit.company_name}</span>
            </div>
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

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    // Merge-at-sign-in (pursuits + follows) — at most once per load.
    useEffect(() => {
        if (user && !guestSyncRef.current) {
            guestSyncRef.current = true;
            void syncGuestPursuitsToServer();
            void syncGuestFollowsToServer();
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
                        <InkButton onClick={() => setAuthPopoverOpen(true)}>Log in</InkButton>
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
                    actions={<InkButton onClick={openWizard}>Add manually</InkButton>}
                />
            }
        >
            <div className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-6 sm:px-10 lg:px-14">
                <div
                    data-testid={total === 0 ? "yours-empty" : undefined}
                    className="flex flex-col divide-y divide-border border border-border sm:flex-row sm:divide-x sm:divide-y-0"
                >
                    {COLUMNS.map((col) => {
                        const cards = groups[col.key];
                        return (
                            <div key={col.key} className="min-w-0 flex-1">
                                <ColumnHead id={`col-${col.key}`} label={col.label} count={cards.length} />
                                {cards.length === 0 ? (
                                    <EmptyColumn text={col.empty.text} link={col.empty.link} />
                                ) : (
                                    <div className="divide-y divide-border">
                                        {cards.map((p) => (
                                            <BoardRow key={p.id} pursuit={p} onClick={() => router.push(`/yours/${p.id}`)} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {groups.closed.length > 0 && (
                    <details className="group mt-8 border-t border-foreground pt-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[13px] font-medium text-foreground">
                            <span>Closed ({groups.closed.length})</span>
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
