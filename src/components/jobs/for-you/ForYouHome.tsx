"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { formatDeckShowingLine } from "@/lib/pursuits/daily-apply-plan";
import { Skeleton } from "@/components/ui/skeleton";
import {
    JOBS_SESSION_FRAME_CLASS,
    JobsSessionLoadingShell,
} from "@/components/layout/jobs-session-loading";
import { ConceptAEmptyPageSlot, ConceptAEmptyState } from "@/components/ui/concept-a-empty-state";
import { RotatingLoadingCopy } from "@/components/jobs/for-you/RotatingLoadingCopy";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { JobCard } from "@/components/jobs/JobCard";
import { JobDetail } from "@/components/jobs/JobDetail";
import { hasMeaningfulDiff } from "@/lib/jobs/for-you/tailor-diff";
import { jobToTailorInput, tailorResumeForJob } from "@/lib/local-ai/tailor-with-engine";
import type { TailorDraft } from "@/lib/local-ai/tailor-resume";
import { exportZipResumePdfFromData } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";
import { resolveDeckShortcut } from "@/lib/jobs/for-you/deck-keyboard";
import { resolveDescriptionHydration } from "@/lib/jobs/for-you/description-pane-state";
import { prefetchIndexesAhead } from "@/lib/jobs/for-you/deck-active-job";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { toast } from "@/lib/toast";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";
import { cn } from "@/lib/utils";
import {
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
} from "@/lib/jobs/resume-cta-copy";
import type { Pursuit } from "@/lib/pursuits/types";

export { JOBS_SESSION_FRAME_CLASS, JOBS_SESSION_FRAME_CLASS as FOR_YOU_HOME_FRAME_CLASS };

/** For-you frame grows with the ranked list — document scroll, not a nested
 *  viewport trap. Same list + detail materials as Search. */

const REPLACE_RESUME_CLASS =
    "text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground";

export interface ForYouHomeProps {
    visiblePacks: PublicJob[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    activeJob: PublicJob | null;
    onSkip: () => void;
    matchScores: Map<string, MatchScore | null> | null;
    resume: ResumeData | null;
    nowMs: number;
    fitResolving: boolean;
    loading: boolean;
    fitActive: boolean;
    hydratedJobs: Map<string, { job: PublicJob; descriptionPending: boolean }>;
    onActivePackChange: (jobId: string) => void;
    onRetryDescription?: (jobId: string) => void;
    onOpenPosting: (job: PublicJob) => void;
    onHomeViewChange: (view: JobsHomeView) => void;
    showSearchCta: boolean;
    onReplaceResume?: () => void;
    hasUsableResume?: boolean;
    /** Load next PAGE chunk into the deck (same loadMore as SERP). */
    onLoadMore?: () => void;
    loadingMore?: boolean;
    hasMore?: boolean;
    /** Known corpus total for optional "N of ~total · Strong first" near Show more. */
    resultTotal?: number | null;
    /** CRAFT-3 — enter-reveal on first pack after auto-reveal. */
    firstRevealEnter?: boolean;
    /** CRAFT-3 — focus deck primary CTA once after first-pack auto-reveal. */
    firstRevealDeckFocus?: boolean;
    onFirstRevealFocusDone?: () => void;
    /** Active pack save — same RowBookmarkButton / optimistic overlay contract as SERP rows. */
    activePursuit?: Pursuit;
    onGoAfter?: (job: PublicJob) => void;
    saveSuccessPulse?: boolean;
}

function RankedListSkeleton() {
    return (
        <div className="overflow-hidden rounded-panel border border-border bg-surface" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex gap-3 border-b border-border px-[var(--list-inset)] py-4 last:border-b-0">
                    <Skeleton className="size-10 shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ForYouHome({
    visiblePacks,
    activeIndex,
    onActiveIndexChange,
    activeJob,
    onSkip,
    matchScores,
    resume,
    nowMs,
    fitResolving,
    loading,
    fitActive,
    hydratedJobs,
    onActivePackChange,
    onRetryDescription,
    onOpenPosting,
    onHomeViewChange,
    showSearchCta,
    onReplaceResume,
    hasUsableResume = false,
    onLoadMore,
    loadingMore = false,
    hasMore = false,
    resultTotal = null,
    firstRevealEnter = false,
    firstRevealDeckFocus = false,
    onFirstRevealFocusDone,
    activePursuit,
    onGoAfter,
    saveSuccessPulse = false,
}: ForYouHomeProps) {
    const draftCache = useRef<Map<string, TailorDraft>>(new Map());
    const [applying, setApplying] = useState(false);
    const [proofLoading, setProofLoading] = useState(false);
    const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        setProofLoading(readPacksProofLoading());
    }, []);

    const prewarmDraft = useCallback(
        async (job: PublicJob) => {
            if (!resume || draftCache.current.has(job.id)) return;
            const hydrated = hydratedJobs.get(job.id)?.job ?? job;
            try {
                const draft = await tailorResumeForJob(resume, jobToTailorInput(hydrated), {
                    allowModel: false,
                });
                draftCache.current.set(job.id, draft);
            } catch {
                // Best-effort pre-warm — apply path generates on demand.
            }
        },
        [resume, hydratedJobs],
    );

    useEffect(() => {
        if (activeJob) void prewarmDraft(activeJob);
        const next = visiblePacks[activeIndex + 1];
        if (next) void prewarmDraft(next);
    }, [activeJob, activeIndex, visiblePacks, prewarmDraft]);

    useEffect(() => {
        const job = visiblePacks[activeIndex];
        if (job) onActivePackChange(job.id);
        for (const index of prefetchIndexesAhead(activeIndex, visiblePacks.length, 3)) {
            onActivePackChange(visiblePacks[index].id);
        }
    }, [activeIndex, visiblePacks, onActivePackChange]);

    useEffect(() => {
        const job = visiblePacks[activeIndex];
        if (!job) return;
        setOpenedIds((prev) => {
            if (prev.has(job.id)) return prev;
            const next = new Set(prev);
            next.add(job.id);
            return next;
        });
    }, [activeIndex, visiblePacks]);

    const exportPdfForJob = useCallback(
        async (job: PublicJob, data: ResumeData) => {
            const filename = deriveResumePdfFilename({
                company: job.company ?? null,
                role: job.title ?? data.profile.profession ?? null,
                fallbackLabel: data.profile.name || "resume",
                dateIso: new Date().toISOString(),
            });
            try {
                await exportZipResumePdfFromData(data, `${filename}.pdf`);
            } catch {
                toast.error("Failed to generate PDF");
                throw new Error("pdf failed");
            }
        },
        [],
    );

    const handleDownloadApply = useCallback(() => {
        if (!activeJob || !resume || applying) return;
        onOpenPosting(activeJob);
        setApplying(true);
        void (async () => {
            try {
                const hydrated = hydratedJobs.get(activeJob.id)?.job ?? activeJob;
                let draft = draftCache.current.get(activeJob.id);
                if (!draft) {
                    draft = await tailorResumeForJob(resume, jobToTailorInput(hydrated), {
                        allowModel: false,
                    });
                    draftCache.current.set(activeJob.id, draft);
                }
                const pdfData = hasMeaningfulDiff(draft) ? draft.tailored : resume;
                await exportPdfForJob(activeJob, pdfData);
            } catch {
                // toast already shown for PDF failure
            } finally {
                setApplying(false);
            }
        })();
    }, [activeJob, resume, applying, hydratedJobs, exportPdfForJob, onOpenPosting]);

    const showLoading = proofLoading || fitResolving || loading || !fitActive;
    const canNavigate = !showLoading && visiblePacks.length > 0;

    useEffect(() => {
        if (!firstRevealDeckFocus || showLoading || visiblePacks.length === 0) return;
        const id = window.requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>('[data-testid="for-you-download-apply"]');
            el?.focus({ preventScroll: true });
            onFirstRevealFocusDone?.();
        });
        return () => window.cancelAnimationFrame(id);
    }, [firstRevealDeckFocus, showLoading, visiblePacks.length, onFirstRevealFocusDone]);

    const shortcutStateRef = useRef({ activeIndex, packsLength: visiblePacks.length, canNavigate, applying });
    shortcutStateRef.current = { activeIndex, packsLength: visiblePacks.length, canNavigate, applying };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const { activeIndex, packsLength, canNavigate, applying } = shortcutStateRef.current;
            if (!canNavigate) return;
            const action = resolveDeckShortcut({
                key: event.key,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                defaultPrevented: event.defaultPrevented,
                target: event.target,
            });
            if (action === "previous") {
                onActiveIndexChange(Math.max(activeIndex - 1, 0));
            } else if (action === "next") {
                onActiveIndexChange(Math.min(activeIndex + 1, packsLength - 1));
            } else if (action === "skip" && !applying) {
                onSkip();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onActiveIndexChange, onSkip]);

    const showingLine = formatDeckShowingLine(visiblePacks.length, resultTotal);
    const activeHydration = activeJob
        ? resolveDescriptionHydration(activeJob, hydratedJobs.get(activeJob.id))
        : null;

    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home">
            {(canNavigate || (hasUsableResume && onReplaceResume)) && (
                <div className="mb-3 flex items-baseline justify-between gap-3">
                    {canNavigate ? (
                        <p
                            className="text-xs text-muted-foreground tabular-nums"
                            data-testid="for-you-deck-position"
                        >
                            {activeIndex + 1} of {visiblePacks.length}
                        </p>
                    ) : (
                        <span />
                    )}
                    {hasUsableResume && onReplaceResume ? (
                        <button
                            type="button"
                            data-testid="jobs-replace-resume"
                            onClick={onReplaceResume}
                            className={REPLACE_RESUME_CLASS}
                        >
                            Replace résumé
                        </button>
                    ) : null}
                </div>
            )}

            {showLoading ? (
                <div data-testid="for-you-loading" className="state-opacity-in space-y-3">
                    <RotatingLoadingCopy variant="deck" className="px-1 text-xs font-semibold" />
                    <RankedListSkeleton />
                </div>
            ) : visiblePacks.length === 0 ? (
                <ConceptAEmptyPageSlot placement="page" className="flex-1" data-testid="for-you-empty-wrap">
                    <ConceptAEmptyState
                        testId="for-you-empty"
                        title="No ranked roles to show right now."
                        description="Try Search to browse the full list—we'll keep your place here."
                        actions={
                            showSearchCta ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="for-you-empty-search-cta"
                                    onClick={() => onHomeViewChange("search")}
                                >
                                    Go to Search
                                </Button>
                            ) : undefined
                        }
                    />
                </ConceptAEmptyPageSlot>
            ) : (
                <div
                    data-testid="for-you-deck"
                    className={cn(
                        "flex min-h-0 flex-col gap-4",
                        "xl:grid xl:grid-cols-[minmax(0,37%)_minmax(0,63%)] xl:items-start",
                        firstRevealEnter && "state-opacity-in",
                    )}
                >
                    {activeHydration && activeJob ? (
                        <div
                            data-testid="for-you-pack"
                            className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-surface xl:order-2"
                        >
                            <div data-testid="for-you-deck-save" className="min-w-0">
                                <JobDetail
                                    job={activeHydration.job}
                                    now={nowMs}
                                    source="serp"
                                    signedIn
                                    onOpenPosting={() => onOpenPosting(activeHydration.job)}
                                    onGoAfter={() => onGoAfter?.(activeHydration.job)}
                                    pursuit={activePursuit}
                                    saveSuccessPulse={saveSuccessPulse}
                                    className="border-0 bg-transparent"
                                    collapseDescription={false}
                                    descriptionPending={activeHydration.descriptionPending}
                                    onRetryDescription={
                                        onRetryDescription
                                            ? () => onRetryDescription(activeHydration.job.id)
                                            : undefined
                                    }
                                    matchScore={matchScores?.get(activeJob.id) ?? null}
                                    resume={resume}
                                    onUploadResume={onReplaceResume}
                                />
                            </div>
                            <div className="flex flex-col gap-2 border-t border-border p-4">
                                {!resume && onReplaceResume ? (
                                    <div className="space-y-2">
                                        <p className="text-xs text-muted-foreground">{FOR_YOU_UPLOAD_PDF_EMPTY}</p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            data-testid="for-you-upload-resume"
                                            onClick={onReplaceResume}
                                            className="inline-flex items-center gap-1.5 font-normal"
                                        >
                                            <UploadSimple size={16} weight="bold" aria-hidden />
                                            Upload résumé
                                        </Button>
                                    </div>
                                ) : null}
                                <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 min-h-11 flex-1 lg:flex-none"
                                    data-testid="for-you-download-apply"
                                    onClick={handleDownloadApply}
                                    disabled={applying || !resume}
                                >
                                    {applying ? (
                                        <>
                                            <CircleNotch size={16} className="mr-2 animate-spin" aria-hidden />
                                            Preparing…
                                        </>
                                    ) : (
                                        FOR_YOU_DOWNLOAD_LABEL
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 min-h-11 flex-1 lg:flex-none"
                                    data-testid="for-you-skip"
                                    onClick={onSkip}
                                    disabled={applying}
                                >
                                    Skip
                                </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div
                        role="listbox"
                        aria-label="Ranked roles"
                        className="flex min-h-0 min-w-0 flex-1 flex-col rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]"
                    >
                        {visiblePacks.map((job, index) => (
                            <JobCard
                                key={job.id}
                                job={job}
                                active={index === activeIndex}
                                opened={openedIds.has(job.id) && index !== activeIndex}
                                onClick={() => onActiveIndexChange(index)}
                                now={nowMs}
                                matchScore={matchScores?.get(job.id) ?? null}
                                position={index + 1}
                            />
                        ))}
                    </div>
                </div>
            )}

            {visiblePacks.length > 0 && !showLoading && (showingLine || (hasMore && onLoadMore)) && (
                <div
                    className="mt-4 flex flex-col items-center gap-2"
                    data-testid="for-you-show-more-wrap"
                >
                    {showingLine ? (
                        <p
                            className="text-xs text-muted-foreground"
                            data-testid="for-you-showing-total"
                        >
                            {showingLine}
                        </p>
                    ) : null}
                    {hasMore && onLoadMore ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="for-you-show-more"
                            onClick={() => void onLoadMore()}
                            disabled={loadingMore}
                            className="text-xs font-semibold"
                        >
                            {loadingMore ? "Loading more…" : "Show more matches"}
                        </Button>
                    ) : null}
                </div>
            )}
        </div>
    );
}

/** Neutral first-paint column while résumé presence is still unknown.
 *  Same frame as For you — never Search chrome. */
export function ForYouHomePending() {
    return (
        <div className={cn(JOBS_SESSION_FRAME_CLASS, "state-opacity-in")} data-testid="for-you-home-pending">
            <JobsSessionLoadingShell />
        </div>
    );
}
